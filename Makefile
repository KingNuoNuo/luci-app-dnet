include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for D-NET
LUCI_DEPENDS:=+rpcd-mod-ucode +curl +jq +ca-bundle
LUCI_PKGARCH:=all
PKG_NAME:=luci-app-dnet
PKG_VERSION:=1.0.0
PKG_RELEASE:=15

include $(TOPDIR)/feeds/luci/luci.mk
