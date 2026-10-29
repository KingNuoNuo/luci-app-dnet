include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for D-NET
LUCI_DEPENDS:=+rpcd-mod-ucode +curl +jq +ca-bundle
LUCI_PKGARCH:=all
PKG_NAME:=luci-app-dnet
PKG_VERSION:=1.0.0
PKG_RELEASE:=16

include $(TOPDIR)/feeds/luci/luci.mk

# luci.mk 只会安装 luasrc/ucode/htdocs/root/src，本包的文件都在 files/ 下，
# 必须显式声明安装规则，并用 INSTALL_BIN 保证路由器侧脚本有可执行位。
define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/init.d $(1)/etc/uci-defaults
	$(INSTALL_CONF) ./files/etc/config/dnet $(1)/etc/config/dnet
	$(INSTALL_BIN) ./files/etc/init.d/dnet $(1)/etc/init.d/dnet
	$(INSTALL_BIN) ./files/etc/uci-defaults/99-dnet $(1)/etc/uci-defaults/99-dnet
	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./files/usr/libexec/dnet-luci-bootstrap $(1)/usr/libexec/dnet-luci-bootstrap
	$(INSTALL_BIN) ./files/usr/libexec/dnet-luci-update $(1)/usr/libexec/dnet-luci-update
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d $(1)/usr/share/rpcd/acl.d $(1)/usr/share/rpcd/ucode
	$(INSTALL_DATA) ./files/usr/share/luci/menu.d/luci-app-dnet.json $(1)/usr/share/luci/menu.d/luci-app-dnet.json
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/luci-app-dnet.json $(1)/usr/share/rpcd/acl.d/luci-app-dnet.json
	$(INSTALL_BIN) ./files/usr/share/rpcd/ucode/luci.dnet $(1)/usr/share/rpcd/ucode/luci.dnet
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/dnet
	$(INSTALL_DATA) ./files/www/luci-static/resources/view/dnet/manage.js $(1)/www/luci-static/resources/view/dnet/manage.js
endef
