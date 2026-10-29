# luci-app-dnet

LuCI management page for the [D-NET](https://github.com/cxbdasheng/dnet) executable.

This package does **not** bundle D-NET. It gives you a LuCI page to set the
executable path and the YAML config path, start/stop the service, download or
upgrade the official release, and jump to the D-NET web UI.

## Install

Prebuilt package (architecture independent, OpenWrt 23.05+ / QWRT):

```sh
opkg install luci-app-dnet_1.0.0-15_all.ipk
```

Or upload `dist/luci-app-dnet_1.0.0-15_all.ipk` to the router and install it
from there. Then open **Services → D-NET**, set the paths, and enable the
service.

## Defaults

| Item | Default |
| --- | --- |
| Executable | `/mnt/sda1/overlay/usr/bin/dnet` |
| Config file | `/mnt/sda1/.dnet_config.yaml` |
| Service state | disabled |
| Listen address | `:9877` (service runs `-c <config> -l :9877`) |

Installing the package neither checks whether D-NET exists nor starts it.

## Behavior

- Starting the service downloads the matching official GitHub release when the
  configured executable is missing, verifies its SHA-256, installs it at the
  configured path, and shows byte/percentage progress in LuCI.
- If the YAML config file is missing, an empty but valid file is created with
  restrictive permissions before the service starts.
- Release tag parsing works with the router's `jq` build even when the optional
  regex library is unavailable. The status view prioritizes a running service
  over a stale bootstrap error.
- Update check and upgrade run only after clicking their respective buttons.
  The upstream `-u` updater verifies release checksums. Upgrade restarts the
  procd service only when it is enabled.
- The Web button opens the current router host on TCP port 9877.

## Build

In an OpenWrt build tree, place this directory under a package feed and run:

```sh
make package/luci-app-dnet/compile V=s
```

A prebuilt `all` architecture IPK is produced by a dependency-free script:

```sh
python3 build_ipk.py            # default 1.0.0-15
python3 build_ipk.py 1.0.0-16   # other release number
```

Output goes to `dist/` together with `SHA256SUMS`. The build is reproducible:
the same sources always produce the same archive hash.

## Repository layout

```
Makefile                                   OpenWrt package makefile
build_ipk.py                               standalone IPK builder
files/etc/config/dnet                      UCI config with defaults
files/etc/init.d/dnet                      procd service
files/etc/uci-defaults/99-dnet             first-install defaults
files/usr/libexec/dnet-luci-bootstrap      download + verify + install binary
files/usr/libexec/dnet-luci-update         update check / upgrade
files/usr/share/luci/menu.d/               LuCI menu entry
files/usr/share/rpcd/acl.d/                rpcd ACL
files/usr/share/rpcd/ucode/luci.dnet       rpcd backend
files/www/luci-static/resources/view/dnet/manage.js
dist/                                      prebuilt IPK + SHA256SUMS
```

## License

Not declared yet. D-NET itself is licensed by its upstream project.
