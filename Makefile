# SPDX-License-Identifier: MIT
#
# LuCI 管理界面 for D-NET（纯脚本包，无编译步骤）。
#
# 用法：把整个目录放进 OpenWrt 源码树的 package/ 下（或作为 feed 的一部分），
#   ./scripts/feeds update -a && ./scripts/feeds install -a
#   make menuconfig     # LuCI -> Applications -> luci-app-dnet
#   make package/luci-app-dnet/compile V=s
#
# luci.mk 来自 feeds/luci，所以必须先 update/install feeds；
# 只想给某个已有源码树临时用，也可以直接拷到 package/ 后跑上面的命令。

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-dnet
PKG_VERSION:=1.0.0
PKG_RELEASE:=21

PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE

LUCI_TITLE:=LuCI support for D-NET
LUCI_DESCRIPTION:=LuCI page for the D-NET binary (DDNS / dynamic CDN / port forwarding / \
  reverse proxy): service start and stop, download or upgrade the release published by \
  KingNuoNuo/dnet with SHA-256 verification, and a link to its web UI.
LUCI_MAINTAINER:=KingNuoNuo <npc1024@users.noreply.github.com>

# luci.dnet 是 rpcd 的 ucode 后端（import fs），下载链路用 curl + jq，
# HTTPS 校验需要根证书。luci-base 已带 ucode-mod-ubus/uci/uloop。
LUCI_DEPENDS:=+luci-base +rpcd-mod-ucode +ucode-mod-fs +curl +jq +ca-bundle
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# 不用 luci.mk 的默认安装规则，因为它靠 cp -pR 保留权限位：源码树从 zip 解压
# 或在 Windows 上 checkout 时可执行位会丢，init.d 脚本就不执行了。
# 这里逐个 INSTALL_BIN，权限是确定的；顺便把 /etc/config/dnet 登记成 conffile，
# 否则 opkg 升级会用出厂默认值盖掉用户在 LuCI 里改过的路径。
define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/init.d $(1)/etc/uci-defaults
	$(INSTALL_CONF) ./root/etc/config/dnet $(1)/etc/config/dnet
	$(INSTALL_BIN) ./root/etc/init.d/dnet $(1)/etc/init.d/dnet
	$(INSTALL_BIN) ./root/etc/uci-defaults/99-dnet $(1)/etc/uci-defaults/99-dnet

	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./root/usr/libexec/dnet-luci-bootstrap $(1)/usr/libexec/dnet-luci-bootstrap
	$(INSTALL_BIN) ./root/usr/libexec/dnet-luci-update $(1)/usr/libexec/dnet-luci-update

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d $(1)/usr/share/rpcd/acl.d $(1)/usr/share/rpcd/ucode
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-dnet.json $(1)/usr/share/luci/menu.d/luci-app-dnet.json
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-dnet.json $(1)/usr/share/rpcd/acl.d/luci-app-dnet.json
	$(INSTALL_BIN) ./root/usr/share/rpcd/ucode/luci.dnet $(1)/usr/share/rpcd/ucode/luci.dnet

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/dnet
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/dnet/manage.js $(1)/www/luci-static/resources/view/dnet/manage.js
endef

define Package/$(PKG_NAME)/conffiles
/etc/config/dnet
endef

# call BuildPackage - OpenWrt buildroot signature
# 上面这行不是注释装饰：include/scan.mk 用 grep 在 Makefile 原文里找
# "call BuildPackage" 才把这个包纳入扫描。luci.mk 里的 eval 是 include
# 进来的，grep 看不到 —— 少了这个标记，包就不会进 tmp/.packageinfo，
# defconfig 不认识 CONFIG_PACKAGE_luci-app-dnet，编译目标也就不存在。
