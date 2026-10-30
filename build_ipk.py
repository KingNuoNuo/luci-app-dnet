# Build the OpenWrt IPK for this package with no external dependencies.
# Usage: python3 build_ipk.py [version-release]
# Output: dist/luci-app-dnet_<version>_all.ipk and dist/SHA256SUMS
from pathlib import Path
import gzip
import hashlib
import io
import sys
import tarfile

root = Path(__file__).resolve().parent
pkg = root / 'files'
version = sys.argv[1] if len(sys.argv) > 1 else '1.0.0-19'
out_dir = root / 'dist'
out_dir.mkdir(exist_ok=True)
out = out_dir / f'luci-app-dnet_{version}_all.ipk'

control = f'''Package: luci-app-dnet
Version: {version}
Depends: luci-base, rpcd-mod-ucode, curl, jq, ca-bundle
Architecture: all
Maintainer: local
Description: LuCI management interface for D-NET
Section: luci
Installed-Size: 16
Source: feeds/luci/applications/luci-app-dnet
SourceName: luci-app-dnet
'''.encode()

conffiles = b'/etc/config/dnet\n'

# Keep the same exec bits the procd scripts and rpcd backend need.
exec_files = {
    'etc/init.d/dnet',
    'etc/uci-defaults/99-dnet',
    'usr/libexec/dnet-luci-bootstrap',
    'usr/libexec/dnet-luci-update',
    'usr/share/rpcd/ucode/luci.dnet',
}


def make_inner(files):
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode='wb', mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w', format=tarfile.USTAR_FORMAT) as tar:
            for name, data, mode in files:
                info = tarfile.TarInfo(name)
                info.size = len(data) if data is not None else 0
                info.mode = mode
                info.uid = info.gid = 0
                info.uname = info.gname = 'root'
                info.mtime = 0
                if data is None:
                    info.type = tarfile.DIRTYPE
                    info.size = 0
                    tar.addfile(info)
                else:
                    tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


control_files = [('.', None, 0o755), ('./control', control, 0o644), ('./conffiles', conffiles, 0o644)]

data_files = [('.', None, 0o755)]
for f in sorted(pkg.rglob('*')):
    if f.is_file():
        rel = f.relative_to(pkg).as_posix()
        data_files.append(('./' + rel, f.read_bytes(), 0o755 if rel in exec_files else 0o644))

dirs = set()
for name, _, _ in data_files:
    for parent in Path(name[2:]).parents:
        if str(parent) != '.':
            dirs.add('./' + parent.as_posix())
data_files.extend((name, None, 0o755) for name in sorted(dirs, key=lambda x: (x.count('/'), x)))
data_files.sort(key=lambda item: (item[0].count('/'), item[0]))

members = [
    ('./debian-binary', b'2.0\n', 0o644),
    ('./data.tar.gz', make_inner(data_files), 0o644),
    ('./control.tar.gz', make_inner(control_files), 0o644),
]
with out.open('wb') as raw:
    with gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w', format=tarfile.GNU_FORMAT) as tar:
            for name, data, mode in members:
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = mode
                info.uid = info.gid = 0
                info.uname = info.gname = 'root'
                info.mtime = 0
                tar.addfile(info, io.BytesIO(data))

digest = hashlib.sha256(out.read_bytes()).hexdigest()
(out_dir / 'SHA256SUMS').write_text(f'{digest} *{out.name}\n')
print(out)
print(digest)
