"""Public social-video downloader. No browser cookies, config files, plugins, or shell commands."""
import ipaddress
import os
import socket
import sys
from urllib.parse import urlsplit

import yt_dlp
from yt_dlp.globals import plugin_dirs

plugin_dirs.value = []

_system_getaddrinfo = socket.getaddrinfo


def public_getaddrinfo(*args, **kwargs):
    # Also guards redirected requests and the final DNS lookup made by the connection.
    addresses = _system_getaddrinfo(*args, **kwargs)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global or ipaddress.ip_address(a[4][0]).is_multicast for a in addresses):
        raise ValueError("Private or reserved network destination rejected")
    return addresses


def public_url(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ("https", "http") or parsed.username or parsed.password or not parsed.hostname:
        raise ValueError("Only public HTTP(S) media requests are allowed")
    if parsed.port not in (None, 80, 443):
        raise ValueError("Unexpected network port")
    addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError("Private or reserved network destination rejected")


class PublicVideoDL(yt_dlp.YoutubeDL):
    def urlopen(self, req):
        public_url(req if isinstance(req, str) else req.url)
        return super().urlopen(req)


def main():
    socket.getaddrinfo = public_getaddrinfo
    url, folder, limit = sys.argv[1:]
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in {"www.youtube.com", "www.instagram.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"}:
        raise ValueError("Unsupported reference URL")
    limit = int(limit)
    os.makedirs(folder, exist_ok=True)

    def progress(data):
        if data.get("downloaded_bytes", 0) > limit or data.get("total_bytes", 0) > limit:
            raise ValueError("Reference exceeds byte limit")

    options = {
        "outtmpl": os.path.join(folder, "reference.%(ext)s"),
        "format": "b[height<=720][ext=mp4]/b[height<=720]/bv[height<=720]",
        "noplaylist": True, "max_downloads": 1, "max_filesize": limit,
        "match_filter": yt_dlp.utils.match_filter_func("!is_live & duration <= 1200"),
        "socket_timeout": 15, "retries": 1, "fragment_retries": 1,
        "concurrent_fragment_downloads": 1, "cachedir": False,
        "cookiefile": None, "cookiesfrombrowser": None,
        "proxy": "", "quiet": True, "no_warnings": True,
        "js_runtimes": {"node": {}}, "remote_components": [],
        "progress_hooks": [progress],
    }
    with PublicVideoDL(options) as downloader:
        try:
            downloader.download([url])
        except yt_dlp.utils.MaxDownloadsReached:
            # yt-dlp raises this after completing the single permitted video.
            # The caller verifies that exactly one non-empty video exists.
            pass


if __name__ == "__main__":
    main()
