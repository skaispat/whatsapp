'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  MessageCircle,
  Key,
  Phone,
  Building2,
  Shield,
  Copy,
  Check,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Unplug,
  ExternalLink,
} from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [userId, setUserId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ valid: boolean; message: string } | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && userId) {
      setWebhookUrl(`${window.location.origin}/api/webhook/${userId}`);
    }
  }, [userId]);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        const { data: config } = await supabase
          .from('whatsapp_portal_configs')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (config) {
          setHasConfig(true);
          setPhoneNumberId(config.phone_number_id);
          setWabaId(config.waba_id);
          setAccessToken(config.access_token);
          setWebhookVerifyToken(config.webhook_verify_token);
          setIsActive(config.is_active);
        }
      }
    };
    load();
  }, [supabase]);

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/verify-meta-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, phoneNumberId }),
      });
      const data = await res.json();
      setTestResult({
        valid: data.valid,
        message: data.valid
          ? `Connected! Phone: ${data.phoneNumber || 'verified'}`
          : data.error || 'Connection failed',
      });
    } catch {
      setTestResult({ valid: false, message: 'Network error' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const { error: updateError } = await supabase
        .from('whatsapp_portal_configs')
        .update({
          phone_number_id: phoneNumberId,
          waba_id: wabaId,
          access_token: accessToken,
          webhook_verify_token: webhookVerifyToken,
          is_active: true,
        })
        .eq('user_id', userId);

      if (updateError) throw updateError;
      setSuccess('Configuration updated successfully!');
      setIsActive(true);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await supabase
        .from('whatsapp_portal_configs')
        .update({ is_active: false })
        .eq('user_id', userId);
      setIsActive(false);
      setSuccess('WhatsApp disconnected.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err?.message || 'Failed to disconnect');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#111b21] flex flex-col items-center py-8 px-4">
      {/* Back Button */}
      <div className="w-full max-w-2xl mb-6">
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-2 text-[#8696a0] hover:text-[#e9edef] transition-colors text-sm"
        >
          <ArrowLeft size={18} /> Back to Dashboard
        </button>
      </div>

      {/* Header */}
      <div className="flex flex-col items-center mb-8">
        <div className="w-12 h-12 bg-[#00a884] rounded-xl flex items-center justify-center mb-3 shadow-lg shadow-[#00a884]/20">
          <MessageCircle size={24} className="text-white" />
        </div>
        <h1 className="text-xl font-light text-[#e9edef]">Settings</h1>
        <p className="text-[#8696a0] text-sm mt-1">Manage your WhatsApp Business connection</p>
      </div>

      <div className="w-full max-w-2xl space-y-6">
        {/* Status Badge */}
        <div className="bg-[#182229] rounded-2xl p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-[#00a884]' : 'bg-[#ff5c5c]'}`} />
            <span className="text-[#e9edef] text-sm font-medium">
              {isActive ? 'WhatsApp Connected' : 'WhatsApp Disconnected'}
            </span>
          </div>
        </div>

        {/* Success/Error */}
        {success && (
          <div className="bg-[#00a884]/10 border border-[#00a884]/20 text-[#00a884] text-sm px-4 py-3 rounded-lg flex items-center gap-2">
            <CheckCircle2 size={16} /> {success}
          </div>
        )}
        {error && (
          <div className="bg-[#ff5c5c]/10 border border-[#ff5c5c]/20 text-[#ff5c5c] text-sm px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Config Form */}
        {hasConfig ? (
          <form onSubmit={handleSave} className="bg-[#182229] rounded-2xl p-8 space-y-5">
            <div>
              <label className="flex items-center gap-2 text-[#8696a0] text-xs mb-1.5 uppercase tracking-wider">
                <Phone size={14} /> Phone Number ID
              </label>
              <input
                type="text"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                required
                className="w-full bg-[#2a3942] text-[#e9edef] px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#00a884]/50 transition-all"
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-[#8696a0] text-xs mb-1.5 uppercase tracking-wider">
                <Building2 size={14} /> WABA ID
              </label>
              <input
                type="text"
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                required
                className="w-full bg-[#2a3942] text-[#e9edef] px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#00a884]/50 transition-all"
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-[#8696a0] text-xs mb-1.5 uppercase tracking-wider">
                <Key size={14} /> Access Token
              </label>
              <textarea
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                required
                rows={3}
                className="w-full bg-[#2a3942] text-[#e9edef] px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#00a884]/50 resize-none font-mono transition-all"
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-[#8696a0] text-xs mb-1.5 uppercase tracking-wider">
                <Shield size={14} /> Webhook Verify Token
              </label>
              <input
                type="text"
                value={webhookVerifyToken}
                onChange={(e) => setWebhookVerifyToken(e.target.value)}
                required
                className="w-full bg-[#2a3942] text-[#e9edef] px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#00a884]/50 transition-all"
              />
            </div>

            {/* Test + Save */}
            <div className="flex items-center gap-3 mt-6">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !accessToken || !phoneNumberId}
                className="flex-1 px-5 py-3 rounded-lg border border-[#00a884]/30 text-[#00a884] text-sm font-semibold hover:bg-[#00a884]/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {testing ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
                Test Connection
              </button>

              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-[#00a884] text-[#111b21] px-5 py-3 rounded-lg font-semibold text-sm hover:bg-[#00a884]/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <><Loader2 size={18} className="animate-spin" /> Saving...</> : 'Save Changes'}
              </button>
            </div>

            {testResult && (
              <div className={`text-sm flex items-center gap-1.5 mt-2 ${testResult.valid ? 'text-[#00a884]' : 'text-[#ff5c5c]'}`}>
                {testResult.valid ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {testResult.message}
              </div>
            )}
          </form>
        ) : (
          <div className="bg-[#182229] rounded-2xl p-8 text-center">
            <p className="text-[#8696a0] text-sm mb-4">No configuration found.</p>
            <button
              onClick={() => router.push('/onboarding')}
              className="bg-[#00a884] text-[#111b21] px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-[#00a884]/90"
            >
              Setup WhatsApp
            </button>
          </div>
        )}

        {/* Webhook URL */}
        {userId && (
          <div className="bg-[#182229] rounded-2xl p-6">
            <h3 className="text-[#e9edef] text-sm font-medium mb-2 flex items-center gap-2">
              <ExternalLink size={16} className="text-[#00a884]" /> Your Webhook URL
            </h3>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-[#0b141a] text-[#00a884] px-4 py-3 rounded-lg text-xs font-mono truncate">
                {webhookUrl}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 p-3 rounded-lg bg-[#2a3942] hover:bg-[#3a4f5b] transition-colors text-[#8696a0] hover:text-[#e9edef]"
              >
                {copied ? <Check size={16} className="text-[#00a884]" /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        )}

        {/* Disconnect */}
        {hasConfig && isActive && (
          <div className="bg-[#182229] rounded-2xl p-6">
            <h3 className="text-[#e9edef] text-sm font-medium mb-2">Danger Zone</h3>
            <p className="text-[#8696a0] text-xs mb-4">
              Disconnecting will stop receiving new messages from WhatsApp.
            </p>
            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="px-5 py-2.5 rounded-lg border border-[#ff5c5c]/30 text-[#ff5c5c] text-sm font-medium hover:bg-[#ff5c5c]/10 transition-all disabled:opacity-40 flex items-center gap-2"
            >
              <Unplug size={16} /> Disconnect WhatsApp
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
