"""
security.py — SSRF Protection, URL sanitization, and safe HTTP streaming fetcher.
"""

import socket
import ipaddress
import logging
from urllib.parse import urlparse, urljoin
from typing import Tuple, Optional
import requests

logger = logging.getLogger(__name__)

# Private and non-routable IPv4 & IPv6 networks to reject
BLOCKED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("192.88.99.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
    ipaddress.ip_network("255.255.255.255/32"),
    # IPv6 equivalents
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("::/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def is_safe_public_url(url: str) -> Tuple[bool, str]:
    """
    Validates that a URL is a legitimate public web address and protects
    against Server-Side Request Forgery (SSRF).
    """
    if not url or not isinstance(url, str):
        return False, "URL is empty or not a string"

    parsed = urlparse(url)
    if parsed.scheme.lower() not in ("http", "https"):
        return False, f"Unsupported scheme '{parsed.scheme}'. Only http and https allowed."

    hostname = parsed.hostname
    if not hostname:
        return False, "URL lacks a valid hostname."

    # Check for localhost / loopback names
    lowered_host = hostname.lower()
    if lowered_host in ("localhost", "localhost.localdomain", "127.0.0.1", "::1"):
        return False, "Blocked target: localhost loopback address."

    # Resolve IP and check against non-routable CIDRs
    try:
        addr_infos = socket.getaddrinfo(hostname, None)
        for family, socktype, proto, canonname, sockaddr in addr_infos:
            ip_str = sockaddr[0]
            ip_obj = ipaddress.ip_address(ip_str)
            for network in BLOCKED_NETWORKS:
                if ip_obj in network:
                    return False, f"Blocked target: resolves to private/internal IP {ip_str}."
    except socket.gaierror as e:
        return False, f"DNS resolution failed for hostname '{hostname}': {e}"
    except Exception as e:
        return False, f"Security verification error: {e}"

    return True, "Safe"


def safe_http_get(
    url: str,
    user_agent: str,
    timeout: float = 10.0,
    max_bytes: int = 5 * 1024 * 1024,
    session: Optional[requests.Session] = None
) -> Tuple[Optional[bytes], Optional[str], Optional[str]]:
    """
    Fetches content with SSRF verification, streaming size limit enforcement,
    and redirect target validation.

    Returns:
        (body_bytes, content_type, error_message)
    """
    is_safe, reason = is_safe_public_url(url)
    if not is_safe:
        return None, None, f"SSRF Block: {reason}"

    headers = {
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml,application/xml,application/pdf;q=0.9,*/*;q=0.8",
        "Accept-Language": "or,en-US,en;q=0.9",
    }

    client = session or requests.Session()
    current_url = url
    max_redirects = 5

    try:
        for _ in range(max_redirects):
            # Verify URL before request
            safe, err = is_safe_public_url(current_url)
            if not safe:
                return None, None, f"Redirect to unsafe host blocked: {err}"

            resp = client.get(
                current_url,
                headers=headers,
                timeout=timeout,
                stream=True,
                allow_redirects=False,
            )

            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("Location")
                if not location:
                    return None, None, f"Redirect HTTP {resp.status_code} missing Location header"
                current_url = urljoin(current_url, location)
                continue

            resp.raise_for_status()

            # Enforce max body size while streaming
            content_type = resp.headers.get("Content-Type", "")
            received_bytes = bytearray()
            for chunk in resp.iter_content(chunk_size=16384):
                if chunk:
                    received_bytes.extend(chunk)
                    if len(received_bytes) > max_bytes:
                        return None, None, f"Response exceeded max allowed size of {max_bytes} bytes."

            return bytes(received_bytes), content_type, None

        return None, None, "Too many redirects"

    except requests.exceptions.Timeout:
        return None, None, f"Connection timed out after {timeout}s"
    except requests.exceptions.RequestException as e:
        return None, None, f"Network request error: {e}"
    except Exception as e:
        return None, None, f"Unexpected error fetching {url}: {e}"
