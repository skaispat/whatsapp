'use client';
import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, MessageSquare, Inbox,
  Heart, ScrollText, CreditCard, ChevronRight, X, Wifi
} from 'lucide-react';

const NAV_ITEMS = [
  // { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  // { key: 'tracker', label: 'Message Tracker', icon: MessageSquare },
  { key: 'inbox', label: 'Chat Inbox', icon: Inbox },
  { key: 'health', label: 'Phone Health', icon: Heart },
  { key: 'logs', label: 'Logs', icon: ScrollText },
];

export default function Sidebar() {
  const { activePage, setActivePage, sidebarOpen, setSidebarOpen, data } = useApp();
  const router = useRouter();

  const handleNav = (key) => {
    setSidebarOpen(false);
    if (key === 'overview') router.push('/dashboard');
    else router.push(`/dashboard/${key}`);
  };

  return (
    <>
      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full z-40 flex flex-col
        transition-transform duration-300 ease-in-out
        w-[240px] bg-[var(--color-wa-surface)] border-r border-[var(--color-wa-border)]
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:static md:z-auto
      `}>
        {/* Brand */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-[var(--color-wa-border)] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#25D366] flex items-center justify-center animate-pulse-green">
              <Wifi size={18} color="#FFFFFF" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-[13px] font-bold text-[var(--color-wa-text)] leading-none">WA Business</div>
              <div className="text-[10px] text-[#25D366] font-medium mt-0.5">Portal v2.0</div>
            </div>
          </div>
          <button
            className="md:hidden text-[var(--color-wa-muted)] hover:text-[var(--color-wa-text)]"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-1">
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
            <div
              key={key}
              className={`nav-item ${activePage === key ? 'active' : ''}`}
              onClick={() => handleNav(key)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {activePage === key && <ChevronRight size={14} className="ml-auto opacity-60" />}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}


