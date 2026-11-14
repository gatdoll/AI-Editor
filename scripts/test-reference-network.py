import importlib.util
import socket
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("download_reference", Path(__file__).with_name("download-reference.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

for address in ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "224.0.0.1", "ff02::1"]:
    with patch.object(module, "_system_getaddrinfo", return_value=[(socket.AF_INET, 1, 6, "", (address, 443))]):
        try:
            module.public_getaddrinfo("example.test", 443)
            raise AssertionError(f"Allowed private address {address}")
        except ValueError:
            pass
with patch.object(module, "_system_getaddrinfo", return_value=[(socket.AF_INET, 1, 6, "", ("8.8.8.8", 443))]):
    assert module.public_getaddrinfo("public.test", 443)
print("reference network: private, loopback, link-local and mapped IPv6 destinations rejected")
