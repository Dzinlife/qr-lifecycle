import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutGrid,
  LogOut,
  QrCode,
  Settings,
  Smartphone,
} from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { api, ApiError, type MeResponse } from "../api/client";

const navigation = [
  { to: "/", label: "频道状态", icon: LayoutGrid, exact: true },
  { to: "/pairing", label: "连接手机", icon: Smartphone },
  { to: "/settings", label: "设置", icon: Settings },
];

export function AppShell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const location = useLocation();

  useEffect(() => {
    let active = true;
    api.me().then(
      (response) => {
        if (active) setMe(response);
      },
      (error: unknown) => {
        if (active && error instanceof ApiError && error.status === 401) onLogout();
      },
    );
    return () => {
      active = false;
    };
  }, [onLogout]);

  const signOut = () => {
    api.clearSession();
    onLogout();
  };

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand" to="/" aria-label="续码工作台">
          <span className="brand__mark"><QrCode size={23} strokeWidth={2.4} /></span>
          <span>
            <strong>{me?.deployment.productName ?? "续码"}</strong>
            <small>QR Lifecycle</small>
          </span>
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
          <div className="account-avatar" aria-hidden="true">
            {(me?.user.displayName || me?.user.email || "续").slice(0, 1).toUpperCase()}
          </div>
          <div className="account-copy">
            <strong>{me?.user.displayName || me?.tenant.name || "正在加载"}</strong>
            <small>{me?.tenant.name ?? "工作区"}</small>
          </div>
          <button className="icon-button" type="button" onClick={signOut} aria-label="退出登录">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <header className="mobile-header">
        <Link className="brand brand--mobile" to="/">
          <span className="brand__mark"><QrCode size={20} /></span>
          <strong>{me?.deployment.productName ?? "续码"}</strong>
        </Link>
        <span className="mobile-header__tenant">{me?.tenant.name ?? ""}</span>
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
