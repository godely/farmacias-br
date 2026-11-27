"""Bundle the three Farmácias BR skills and a personal HTTPS MCP for Claude Desktop."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", required=True, help="HTTPS MCP endpoint")
parser.add_argument("--output", type=Path, required=True, help="New plugin ZIP file")
args = parser.parse_args()
url = urlsplit(args.url)
if url.scheme != "https" or not url.hostname or url.username is not None or url.password is not None or url.query or url.fragment:
    parser.error("Provide an HTTPS URL without embedded credentials, query or fragment")
base = Path(__file__).resolve().parents[1] / "plugins" / "farmacias-br"
files = {".claude-plugin/plugin.json": (base / ".claude-plugin/plugin.json").read_bytes()}
for path in sorted((base / "skills").glob("*/SKILL.md")):
    files[path.relative_to(base).as_posix()] = path.read_bytes()
servers = {"mcpServers": {"farmacias-br": {"type": "http", "url": args.url}}}
files[".mcp.json"] = (json.dumps(servers, indent=2) + "\n").encode()
with ZipFile(args.output, "x") as archive:
    for name, content in sorted(files.items()):
        entry = ZipInfo(name)
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, content, compress_type=ZIP_DEFLATED)
