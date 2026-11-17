# luci-app-dnet

LuCI management page for the [D-NET](https://github.com/KingNuoNuo/dnet) executable
(fork of [cxbdasheng/dnet](https://github.com/cxbdasheng/dnet)).

This package does **not** bundle D-NET. It gives you a LuCI page to set the
executable path and the YAML config path, start/stop the service, download or
upgrade the release published by **KingNuoNuo/dnet**, and jump to the D-NET web UI.

The repository root **is** the package directory (`luci-app-dnet/`), so it can be
dropped straight into an OpenWrt source tree — no repacking, no `files/` prefix.

## Build from source

### Option 1 — put it under `package/`

```sh
cd openwrt
git clone https://github.com/KingNuoNuo/luci-app-dnet.git package/luci-app-dnet
./scripts/feeds update -a
./scripts/feeds install -a          # luci.mk lives in feeds/luci, required
make menuconfig                     # LuCI -> Applications -> luci-app-dnet
make package/luci-app-dnet/compile V=s
```

The IPK ends up under `bin/packages/<arch>/base/` (`<arch>` may be `base`,
`packages` or similar depending on your tree).

> `include $(TOPDIR)/feeds/luci/luci.mk` is used, so **feeds must be installed
> before configuring**. Without them the build stops with
> `.../feeds/luci/luci.mk: No such file or directory`.

### Option 2 — add it as a custom feed

```sh
echo 'src-git dnet https://github.com/KingNuoNuo/luci-app-dnet.git' >> feeds.conf.default
./scripts/feeds update dnet
./scripts/feeds install -a -p dnet
make package/luci-app-dnet/compile V=s
```

### Option 3 — install a prebuilt, architecture-independent IPK

```sh
opkg install luci-app-dnet_1.0.0-21_all.ipk
```

`dist/` holds the IPK plus `SHA256SUMS`. It is produced without an OpenWrt tree
by a dependency-free script:

```sh
python3 build_ipk.py                # default 1.0.0-21
python3 build_ipk.py 1.0.0-22       # other version/release
```

The build is reproducible: the same sources always produce the same archive hash.

## Requirements

| Item | Why |
| --- | --- |
| OpenWrt 23.05 or newer | ucode-based LuCI (`luci-base`), `rpcd-mod-ucode` |
| `luci-base` | menu, view base class, `LuCI` JS libraries |
| `rpcd-mod-ucode` | loads `/usr/share/rpcd/ucode/luci.dnet` as the ubus backend |
| `ucode-mod-fs` | the backend imports `fs` (`readfile`) |
| `curl`, `jq` | release lookup, download progress, checksum parsing |
| `ca-bundle` | HTTPS verification for GitHub |

All of them are declared in `LUCI_DEPENDS`, so `make menuconfig` pulls them in
automatically.

## Defaults

| Item | Default |
| --- | --- |
| Executable | `/mnt/sda1/overlay/usr/bin/dnet` |
| Config file | `/mnt/sda1/.dnet_config.yaml` |
| Service state | disabled |
| Listen address | `:9877` (service runs `-c <config> -l :9877`) |

Installing the package neither checks whether D-NET exists nor starts it.
`/etc/config/dnet` is registered as a **conffile**, so upgrading the package
keeps the paths you set in LuCI instead of resetting them.

## Behavior

- Starting the service downloads the matching release from **KingNuoNuo/dnet**
  when the configured executable is missing, verifies its SHA-256, installs it
  at the configured path, and shows byte/percentage progress in LuCI.
- Release assets must follow `dnet_<version>_linux_<x86_64|arm64|armv7|armv6|armv5|i386>.tar.gz`
  plus a `checksums.txt` (sha256sum format); this is what the D-NET release
  workflow produces.
- If the YAML config file is missing, an empty but valid file is created with
  restrictive permissions before the service starts.
- Release tag parsing works with the router's `jq` build even when the optional
  regex library is unavailable. The status view prioritizes a running service
  over a stale bootstrap error.
- Update check and upgrade run only after clicking their respective buttons.
  `dnet -u` in the fork checks the same KingNuoNuo/dnet releases and verifies
  `checksums.txt`. Upgrade restarts the procd service only when it is enabled.
- Upgrades run through the LuCI-verified download path (`dnet-luci-bootstrap`),
  so they work even when the installed binary reports a non-semantic version
  (DEV or date builds): `dnet -u` cannot compare those locally, but the
  download only depends on the release assets. Download progress stays visible
  in the "Program status" section even while the service is running, and a
  notification appears when the upgrade finishes (or fails).
- The upgrade button also appears when the update log reports an unparseable
  current version instead of staying hidden behind a failed check.
- The Web button opens the current router host on TCP port 9877.
- The **Config encryption** section drives the binary's `-secret` commands with
  the configured config path: it shows how many fields are encrypted, where the
  master key lives, generates a key (displayed once for offline backup),
  encrypts the existing plaintext in place, and decrypts it back when rotating
  keys. It never offers "generate key" while the config already holds ciphertext,
  so old data cannot be made unreadable by accident.

## Repository layout

```
Makefile                                        OpenWrt package makefile (luci.mk)
build_ipk.py                                    standalone IPK builder (no SDK needed)
root/etc/config/dnet                            UCI config with defaults (conffile)
root/etc/init.d/dnet                            procd service
root/etc/uci-defaults/99-dnet                   first-install defaults
root/usr/libexec/dnet-luci-bootstrap            download + verify + install binary
root/usr/libexec/dnet-luci-update               update check / upgrade
root/usr/share/luci/menu.d/luci-app-dnet.json   LuCI menu entry
root/usr/share/rpcd/acl.d/luci-app-dnet.json    rpcd ACL
root/usr/share/rpcd/ucode/luci.dnet             rpcd backend (ubus object luci.dnet)
htdocs/luci-static/resources/view/dnet/manage.js  LuCI view
dist/                                           prebuilt IPK + SHA256SUMS
```

`root/` is installed to `/`, `htdocs/` to `/www` — the standard LuCI layout.
The Makefile installs files explicitly with `INSTALL_BIN` instead of relying on
`cp -pR`, so executable bits survive a Windows checkout or a zip download.

## License

MIT, see [LICENSE](LICENSE). D-NET itself is licensed by its upstream project.
