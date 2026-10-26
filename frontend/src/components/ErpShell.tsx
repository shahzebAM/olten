import { useState, type ReactNode } from 'react';

export default function ErpShell({ company, title, username, navigation, children, onWorkspace, onChangeCompany, onLogout, standalone = false }: {
  company: string;
  title: string;
  username: string;
  navigation: ReactNode;
  children: ReactNode;
  onWorkspace: () => void;
  onChangeCompany: () => void;
  onLogout: () => void;
  standalone?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Document uploads retain their existing disabled Gateway action and folder
  // navigation; do not introduce an alternate route around that upload lock.
  if (standalone) return <div className="erp-modern erp-standalone"><div className="erp-content">{children}</div></div>;
  return (
    <div className={`erp-modern erp-shell${collapsed ? ' erp-shell-collapsed' : ''}${mobileOpen ? ' erp-nav-open' : ''}`} onKeyDown={event => { if (event.key === 'Escape') setMobileOpen(false); }}>
      <a className="erp-skip-link" href="#erp-main">Skip to workspace</a>
      {mobileOpen && <button type="button" className="erp-nav-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside id="erp-navigation" className="erp-sidebar" aria-label="Workspace navigation">
        <div className="erp-brand-row">
          <button type="button" className="erp-brand" onClick={onWorkspace} aria-label="Olten workspace overview"><span className="erp-brand-mark">o<span>.</span></span><span className="erp-nav-label">olten<span className="erp-brand-caption">BUSINESS WORKSPACE</span></span></button>
          <button type="button" className="erp-collapse" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={collapsed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} /></svg></button>
        </div>
        <div className="erp-company"><span className="erp-company-mark">{company.slice(0, 1).toUpperCase()}</span><span className="erp-nav-label"><strong>{company}</strong><small>Company workspace</small></span></div>
        <div className="erp-nav-scroll" onClick={event => { if ((event.target as Element).closest('button[data-workspace-link]')) setMobileOpen(false); }}>{navigation}</div>
        <div className="erp-sidebar-footer"><span className="erp-online-dot" /><span className="erp-nav-label">Signed in as <strong>{username}</strong></span></div>
      </aside>
      <div className="erp-shell-body">
        <header className="erp-topbar">
          <div className="erp-breadcrumb"><button type="button" className="erp-mobile-menu" aria-label="Open navigation" aria-controls="erp-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(value => !value)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button><button type="button" onClick={onWorkspace}>Workspace</button><span aria-hidden="true">/</span><strong>{title}</strong></div>
          <div className="erp-topbar-actions"><button type="button" onClick={onChangeCompany}>Switch company</button><span className="erp-user-avatar" aria-hidden="true">{username.slice(0, 2).toUpperCase()}</span><button type="button" onClick={onLogout}>Sign out</button></div>
        </header>
        <div id="erp-main" tabIndex={-1} className="erp-content">{children}</div>
      </div>
    </div>
  );
}
