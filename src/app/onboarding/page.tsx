'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  MessageCircle,
  Key,
  Phone,
  Building2,
  Shield,
  Copy,
  Check,
  Loader2,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
} from 'lucide-react';

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();

  const [userId, setUserId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('');

  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ valid: boolean; message: string } | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [existingConfig, setExistingConfig] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && userId) {
      setWebhookUrl(`${window.location.origin}/api/webhook/${userId}`);
    }
  }, [userId]);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        // Check existing config
        const { data: config } = await supabase
          .from('whatsapp_portal_configs')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (config) {
          setExistingConfig(true);
          setPhoneNumberId(config.phone_number_id);
          setWabaId(config.waba_id);
          setAccessToken(config.access_token);
          setWebhookVerifyToken(config.webhook_verify_token);
        }
      }
    };
    getUser();
  }, [supabase]);

  const handleCopyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTestConnection = async () => {
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
    setLoading(true);

    try {
      if (existingConfig) {
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
      } else {
        const { error: insertError } = await supabase
          .from('whatsapp_portal_configs')
          .insert({
            user_id: userId,
            phone_number_id: phoneNumberId,
            waba_id: wabaId,
            access_token: accessToken,
            webhook_verify_token: webhookVerifyToken,
          });
        if (insertError) throw insertError;
      }
      router.push('/dashboard');
    } catch (err: any) {
      setError(err?.message || 'Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-wa-bg)] flex flex-col items-center py-10 px-4 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col items-center mb-10 relative w-full max-w-2xl">
        <Link
          href="/dashboard"
          className="absolute left-0 top-1 text-[var(--color-wa-muted)] hover:text-[var(--color-wa-text)] flex items-center gap-1.5 text-[13px] font-medium transition-colors"
        >
          <ChevronLeft size={16} />
          Back to Dashboard
        </Link>
        <div className="w-16 h-16 bg-[#25D366] rounded-[22px] flex items-center justify-center mb-4 shadow-lg shadow-[#25D366]/20">
          <MessageCircle size={32} className="text-white fill-white/10" />
        </div>
        <h1 className="text-[26px] font-bold text-[var(--color-wa-text)] tracking-tight">
          {existingConfig ? 'Update Account Config' : 'Project Onboarding'}
        </h1>
        <p className="text-[var(--color-wa-muted)] text-[14px] mt-1.5 text-center max-w-md font-medium">
          Connect your Meta Business credentials to enable real messaging features
        </p>
      </div>

      <div className="w-full max-w-2xl space-y-6">
        {/* Credentials Form */}
        <form onSubmit={handleSave} className="card p-8 md:p-10">
          <h2 className="text-[17px] font-bold text-[var(--color-wa-text)] mb-6 flex items-center gap-2">
            <Key size={18} className="text-[#25D366]" />
            Meta API Credentials
          </h2>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 text-[13px] px-4 py-3 rounded-xl mb-6 flex items-center gap-2 font-medium">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Phone Number ID */}
              <div>
                <label className="flex items-center gap-2 text-[var(--color-wa-muted)] text-[11px] font-bold uppercase tracking-[0.05em] mb-2">
                  <Phone size={14} /> Phone Number ID
                </label>
                <input
                  type="text"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  required
                  placeholder="e.g. 109876543210"
                />
              </div>

              {/* WABA ID */}
              <div>
                <label className="flex items-center gap-2 text-[var(--color-wa-muted)] text-[11px] font-bold uppercase tracking-[0.05em] mb-2">
                  <Building2 size={14} /> WhatsApp Business ID
                </label>
                <input
                  type="text"
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  required
                  placeholder="e.g. 102938475610"
                />
              </div>
            </div>

            {/* Access Token */}
            <div>
              <label className="flex items-center gap-2 text-[var(--color-wa-muted)] text-[11px] font-bold uppercase tracking-[0.05em] mb-2">
                <Key size={14} /> Permanent Access Token
              </label>
              <textarea
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                required
                placeholder="Paste your System User Access Token here..."
                rows={4}
                className="font-mono text-[13px] leading-relaxed"
              />
            </div>

            {/* Webhook Verify Token */}
            <div>
              <label className="flex items-center gap-2 text-[var(--color-wa-muted)] text-[11px] font-bold uppercase tracking-[0.05em] mb-2">
                <Shield size={14} /> Webhook Verify Token
              </label>
              <input
                type="text"
                value={webhookVerifyToken}
                onChange={(e) => setWebhookVerifyToken(e.target.value)}
                required
                placeholder="Create a secret string (e.g. mysecretv3)"
              />
              <p className="text-[var(--color-wa-muted)] text-[11px] mt-2 font-medium">
                Tip: Create any secure string. You must use the same string in Meta Developer Portal.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 mt-8 pt-6 border-t border-[var(--color-wa-border)]">
            <button
              type="submit"
              disabled={loading}
              className="btn-green w-full sm:flex-1 py-3 text-[14px] flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Saving...
                </>
              ) : (
                existingConfig ? 'Update Account' : 'Initialize Account'
              )}
            </button>

            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || !accessToken || !phoneNumberId}
              className="btn-outline w-full sm:w-auto px-6 py-3 text-[14px] flex items-center justify-center gap-2 font-semibold"
            >
              {testing ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
              Test Connection
            </button>
          </div>

          {testResult && (
            <div className={`mt-4 px-4 py-2.5 rounded-lg text-[13px] font-semibold flex items-center gap-2 ${testResult.valid ? 'bg-green-50 text-[#128C7E]' : 'bg-red-50 text-red-600'}`}>
              {testResult.valid ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              {testResult.message}
            </div>
          )}
        </form>

        {/* Webhook URL Card */}
        {userId && (
          <div className="card p-6 border-l-4 border-l-[#25D366]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[var(--color-wa-text)] text-[15px] font-bold flex items-center gap-2">
                <ExternalLink size={18} className="text-[#25D366]" />
                Webhook Configuration
              </h3>
              <div className="badge badge-green">Required</div>
            </div>

            <p className="text-[var(--color-wa-muted)] text-[13px] mb-4 font-medium leading-relaxed">
              Copy this callback URL into Meta Dashboard → WhatsApp → Configuration → Webhook URL:
            </p>

            <div className="flex items-center gap-2 bg-[var(--color-wa-bg)] p-3 rounded-xl border border-[var(--color-wa-border)]">
              <code className="flex-1 text-[var(--color-wa-teal)] text-[12px] font-mono truncate font-bold">
                {webhookUrl}
              </code>
              <button
                onClick={handleCopyWebhookUrl}
                className="shrink-0 p-2.5 rounded-lg bg-[var(--color-wa-surface)] hover:bg-[var(--color-wa-bg)] border border-[var(--color-wa-border)] transition-all text-[var(--color-wa-muted)] hover:text-[var(--color-wa-text)] shadow-sm"
                title="Copy to clipboard"
              >
                {copied ? <Check size={16} className="text-[#25D366]" /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="card p-6 md:p-8">
          <h3 className="text-[15px] font-bold text-[var(--color-wa-text)] mb-5">Quick Setup Guide</h3>
          <div className="space-y-4">
            {[
              { step: 1, text: 'Go to developers.facebook.com and create a Meta App' },
              { step: 2, text: 'Add the WhatsApp product to your app from dashboard' },
              { step: 3, text: 'Get your Phone Number ID from API Setup section' },
              { step: 4, text: 'Generate a Permanent System User Token via Business Manager' },
              { step: 5, text: 'Configure the Webhook URL above in Meta Configuration' },
              { step: 6, text: 'Subscribe to messages, message_deliveries, and message_reads' },
            ].map((s) => (
              <div key={s.step} className="flex gap-4 items-start">
                <div className="w-6 h-6 rounded-full bg-[var(--color-wa-bg)] flex-shrink-0 flex items-center justify-center text-[var(--color-wa-teal)] text-[11px] font-bold border border-[var(--color-wa-border)]">
                  {s.step}
                </div>
                <p className="text-[13px] text-[var(--color-wa-muted)] font-medium pt-0.5">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="mt-12 text-center text-[12px] text-[var(--color-wa-muted)] font-medium">
        Powered by <span className="text-[#25D366] font-bold">Botivate</span> WhatsApp System
      </footer>
    </div>
  );
}
