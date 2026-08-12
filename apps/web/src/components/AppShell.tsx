import type { ReactNode } from "react";
import { LayoutGrid, LogOut, QrCode, Settings, Smartphone } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";

import type { MeResponse } from "../api/client";

const navigation = [
  { to: "/", label: "频道状态", icon: LayoutGrid, exact: true },
  { to: "/settings", label: "设置", icon: Settings },
];

export function AppShell({
  children,
  me,
  onLogout,
}: {
  children: ReactNode;
  me: MeResponse;
  onLogout: () => void;
}) {
  const location = useLocation();

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand" to="/" aria-label="Fallinlife 群码">
          <span className="brand__mark"><QrCode size={23} strokeWidth={2.4} /></span>
          <span><strong>{me.deployment.productName}</strong><small>QR Lifecycle</small></span>
        </Link>

        <nav className="sidebar__nav" aria-label="主导航">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact ?? false}
              className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`}
            >
              <item.icon size={19} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__account">
          <div className="account-avatar" aria-hidden="true"><Smartphone size={17} /></div>
          <div className="account-copy">
            <strong>已由手机授权</strong>
            <small>可在 App 中撤销</small>
          </div>
          <button className="icon-button" type="button" onClick={onLogout} aria-label="断开此浏览器">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <header className="mobile-header">
        <Link className="brand brand--mobile" to="/">
          <span className="brand__mark"><QrCode size={20} /></span>
          <strong>{me.deployment.productName}</strong>
        </Link>
        <span className="mobile-header__tenant">手机已授权</span>
      </header>

      <main className="main-content" key={location.pathname}>{children}</main>

      <nav className="bottom-nav" aria-label="移动端导航">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact ?? false}
            className={({ isActive }) => `bottom-nav__link${isActive ? " is-active" : ""}`}
          >
            <item.icon size={20} aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
