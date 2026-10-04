import React, { useState, useEffect } from 'react';
import {
  FileText,
  Save,
  RotateCcw,
  Eye,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Info,
  Copy,
  Check,
  Radio,
  Zap,
} from 'lucide-react';
import { api } from '../services/api.js';
import { copyTextToClipboard } from '../utils/clipboard.js';
import type { MessageTemplate, AppSettings, WhatsAppStatus } from '../types/index.js';

interface TemplatesPageProps {
  settings: AppSettings | null;
  whatsAppStatus: WhatsAppStatus | null;
  onNotification: (msg: string, isError?: boolean) => void;
}

interface VariableDef {
  tag: string;
  desc: string;
  sample: string;
}

const TEMPLATE_META: Record<
  string,
  {
    name: string;
    description: string;
    icon: string;
    color: string;
    variables: VariableDef[];
  }
> = {
  SIGNAL: {
    name: 'Signal Message',
    description: 'Broadcasted to your WhatsApp channel before every WinGo 1M draw period.',
    icon: '🎯',
    color: 'emerald',
    variables: [
      { tag: '{issueNumber}', desc: 'Upcoming draw issue / period number', sample: '202609231234' },
      { tag: '{prediction}', desc: 'Predicted size (BIG or SMALL)', sample: 'BIG' },
      { tag: '{size}', desc: 'Alias for prediction size', sample: 'BIG' },
      { tag: '{color}', desc: 'Predicted color (RED or GREEN)', sample: 'GREEN' },
      { tag: '{confidence}', desc: 'Calculated algorithmic confidence %', sample: '78' },
      { tag: '{time}', desc: 'Formatted current time (HH:MM:SS)', sample: '14:30:00' },
      { tag: '{date}', desc: 'Formatted current date (YYYY-MM-DD)', sample: '2026-09-23' },
    ],
  },
  WIN: {
    name: 'WIN Result Message',
    description: 'Dispatched immediately when the actual result matches our prediction.',
    icon: '✅',
    color: 'emerald',
    variables: [
      { tag: '{issueNumber}', desc: 'Settled draw issue / period number', sample: '202609231234' },
      { tag: '{resultNumber}', desc: 'Actual winning number (0 - 9)', sample: '7' },
      { tag: '{resultSize}', desc: 'Actual winning size (BIG or SMALL)', sample: 'BIG' },
      { tag: '{resultColor}', desc: 'Actual winning color(s)', sample: 'GREEN' },
      { tag: '{prediction}', desc: 'Our predicted size', sample: 'BIG' },
      { tag: '{predictionSize}', desc: 'Our predicted size', sample: 'BIG' },
      { tag: '{predictionColor}', desc: 'Our predicted color', sample: 'GREEN' },
      { tag: '{confidence}', desc: 'Initial confidence %', sample: '78' },
      { tag: '{status}', desc: 'Result status', sample: 'WIN' },
      { tag: '{time}', desc: 'Current time', sample: '14:31:00' },
      { tag: '{date}', desc: 'Current date', sample: '2026-09-23' },
    ],
  },
  LOSS: {
    name: 'LOSS Result Message',
    description: 'Dispatched immediately when the actual result opposes our prediction.',
    icon: '❌',
    color: 'rose',
    variables: [
      { tag: '{issueNumber}', desc: 'Settled draw issue / period number', sample: '202609231234' },
      { tag: '{resultNumber}', desc: 'Actual winning number (0 - 9)', sample: '2' },
      { tag: '{resultSize}', desc: 'Actual winning size (BIG or SMALL)', sample: 'SMALL' },
      { tag: '{resultColor}', desc: 'Actual winning color(s)', sample: 'RED' },
      { tag: '{prediction}', desc: 'Our predicted size', sample: 'BIG' },
      { tag: '{predictionSize}', desc: 'Our predicted size', sample: 'BIG' },
      { tag: '{predictionColor}', desc: 'Our predicted color', sample: 'GREEN' },
      { tag: '{confidence}', desc: 'Initial confidence %', sample: '78' },
      { tag: '{status}', desc: 'Result status', sample: 'LOSS' },
      { tag: '{time}', desc: 'Current time', sample: '14:31:00' },
      { tag: '{date}', desc: 'Current date', sample: '2026-09-23' },
    ],
  },
  TEST: {
    name: 'Test Message',
    description: 'Sent when clicking "Send Test Message" to verify WhatsApp Newsletter channel delivery.',
    icon: '🧪',
    color: 'blue',
    variables: [
      { tag: '{issueNumber}', desc: 'Sample issue number', sample: '202609230000' },
      { tag: '{prediction}', desc: 'Sample prediction', sample: 'BIG' },
      { tag: '{size}', desc: 'Sample size', sample: 'BIG' },
      { tag: '{color}', desc: 'Sample color', sample: 'GREEN' },
      { tag: '{confidence}', desc: 'Sample confidence %', sample: '85' },
      { tag: '{time}', desc: 'Current time', sample: '14:30:00' },
      { tag: '{date}', desc: 'Current date', sample: '2026-09-23' },
    ],
  },
};

export const TemplatesPage: React.FC<TemplatesPageProps> = ({
  settings,
  whatsAppStatus,
  onNotification,
}) => {
  const [templates, setTemplates] = useState<Record<string, MessageTemplate>>({});
  const [activeTab, setActiveTab] = useState<'SIGNAL' | 'WIN' | 'LOSS' | 'TEST'>('SIGNAL');
  const [editedText, setEditedText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  // Load templates on mount
  useEffect(() => {
    fetchTemplates();
  }, []);

  // Update edited text and preview whenever active tab changes
  useEffect(() => {
    if (templates[activeTab]) {
      setEditedText(templates[activeTab].template);
      generatePreview(activeTab, templates[activeTab].template);
    }
  }, [activeTab, templates]);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await api.getTemplates();
      const map: Record<string, MessageTemplate> = {};
      for (const t of res.templates) {
        map[t.key] = t;
      }
      setTemplates(map);
      if (map[activeTab]) {
        setEditedText(map[activeTab].template);
        generatePreview(activeTab, map[activeTab].template);
      }
    } catch (err: any) {
      onNotification(err.message || 'Failed to load message templates', true);
    } finally {
      setLoading(false);
    }
  };

  const generatePreview = async (key: string, text: string) => {
    setPreviewLoading(true);
    try {
      const res = await api.previewTemplate(key, text);
      setPreviewContent(res.rendered);
    } catch {
      // Fallback local preview interpolation
      let interpolated = text;
      const meta = TEMPLATE_META[key];
      if (meta) {
        for (const v of meta.variables) {
          interpolated = interpolated.split(v.tag).join(v.sample);
        }
      }
      setPreviewContent(interpolated);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setEditedText(val);
    generatePreview(activeTab, val);
  };

  const handleInsertVariable = async (tag: string) => {
    const newText = editedText + tag;
    setEditedText(newText);
    generatePreview(activeTab, newText);

    await copyTextToClipboard(tag);
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(null), 1500);
  };

  const handleCopyPreview = async () => {
    if (!previewContent) return;
    const ok = await copyTextToClipboard(previewContent);
    if (ok) {
      setCopiedPreview(true);
      onNotification('Rendered WhatsApp preview message copied to clipboard!');
      setTimeout(() => setCopiedPreview(false), 2000);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.updateTemplate(activeTab, editedText, true);
      setTemplates((prev) => ({
        ...prev,
        [activeTab]: res.template,
      }));
      onNotification(
        `Template "${TEMPLATE_META[activeTab]?.name || activeTab}" saved successfully. Takes effect immediately without server restart!`
      );
    } catch (err: any) {
      onNotification(err.message || 'Failed to save template', true);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (
      !window.confirm(
        `Are you sure you want to reset "${TEMPLATE_META[activeTab]?.name}" back to factory default?`
      )
    ) {
      return;
    }

    setResetting(true);
    try {
      const res = await api.resetTemplate(activeTab);
      setTemplates((prev) => ({
        ...prev,
        [activeTab]: res.template,
      }));
      setEditedText(res.template.template);
      generatePreview(activeTab, res.template.template);
      onNotification(`Template "${TEMPLATE_META[activeTab]?.name}" has been reset to default.`);
    } catch (err: any) {
      onNotification(err.message || 'Failed to reset template', true);
    } finally {
      setResetting(false);
    }
  };

  const handleSendTestMessage = async () => {
    setSendingTest(true);
    try {
      const res = await api.sendTestTemplateMessage();
      onNotification(res.message || 'Test message sent successfully to your WhatsApp channel!');
    } catch (err: any) {
      onNotification(err.message || 'Failed to send test message', true);
    } finally {
      setSendingTest(false);
    }
  };

  const currentMeta = TEMPLATE_META[activeTab];
  const activeDest = settings?.activeDestination || settings?.newsletterJid || null;
  const isWaConnected = whatsAppStatus?.status === 'connected';

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 space-y-4">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        <p className="text-neutral-400 text-sm">Loading message templates...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 bg-neutral-900 border border-neutral-800 rounded-2xl">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-400" />
            WhatsApp Message Templates
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Customize exact WhatsApp messages broadcasted to your subscribers. Stored safely and applied live without restarting.
          </p>
        </div>

        {/* Global Test Message Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSendTestMessage}
            disabled={sendingTest || !activeDest || !isWaConnected}
            className={`px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-all shadow-lg ${
              !activeDest || !isWaConnected
                ? 'bg-neutral-800 text-neutral-500 border border-neutral-700 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/40 active:scale-95'
            }`}
            title={
              !activeDest
                ? 'Configure a WhatsApp Channel in Settings first'
                : !isWaConnected
                ? 'Pair WhatsApp in the WhatsApp tab first'
                : 'Dispatches active TEST message template to your channel'
            }
          >
            {sendingTest ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Send Test Message
          </button>
        </div>
      </div>

      {/* Target Destination Banner */}
      <div className="p-3.5 bg-neutral-900/60 border border-neutral-800 rounded-xl flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-neutral-300">
          <Radio className={`w-4 h-4 ${activeDest ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
          <span>
            Active Broadcast Channel:{' '}
            <strong className="text-white font-mono">{activeDest || 'None configured (Set in Settings)'}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
              isWaConnected
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isWaConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}
            />
            {isWaConnected ? 'WhatsApp Connected' : 'WhatsApp Disconnected'}
          </span>
        </div>
      </div>

      {/* Template Selector Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {(['SIGNAL', 'WIN', 'LOSS', 'TEST'] as const).map((key) => {
          const meta = TEMPLATE_META[key];
          const isSelected = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                isSelected
                  ? 'bg-neutral-800/90 border-emerald-500/50 shadow-md ring-1 ring-emerald-500/30'
                  : 'bg-neutral-900/60 border-neutral-800 hover:bg-neutral-800/40 text-neutral-400'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-lg">{meta.icon}</span>
                <span
                  className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                    isSelected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {key}
                </span>
              </div>
              <div className="mt-2.5">
                <div className={`text-xs font-semibold ${isSelected ? 'text-white' : 'text-neutral-300'}`}>
                  {meta.name}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Editor & Preview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Template Editor (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-5 bg-neutral-900 border border-neutral-800 rounded-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <span>{currentMeta.icon}</span>
                  {currentMeta.name}
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">{currentMeta.description}</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  disabled={resetting || saving}
                  className="px-2.5 py-1.5 text-xs text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg flex items-center gap-1.5 transition-colors"
                  title="Reset this template to factory default"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${resetting ? 'animate-spin' : ''}`} />
                  Reset Default
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center gap-1.5 transition-all shadow-md active:scale-95"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save Template
                </button>
              </div>
            </div>

            {/* Textarea */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-300">Message Content</label>
              <textarea
                value={editedText}
                onChange={handleTextChange}
                rows={11}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3.5 text-xs font-mono text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all resize-y leading-relaxed"
                placeholder="Enter template content..."
              />
            </div>

            {/* Variable Tags Quick-Insert */}
            <div className="space-y-2 pt-2 border-t border-neutral-800">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-neutral-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  Available Variables
                </span>
                <span className="text-[11px] text-neutral-500">Click variable to append to template</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {currentMeta.variables.map((v) => (
                  <button
                    key={v.tag}
                    type="button"
                    onClick={() => handleInsertVariable(v.tag)}
                    className="group px-2.5 py-1 bg-neutral-800/80 hover:bg-emerald-950/40 hover:border-emerald-500/40 border border-neutral-700/60 rounded-lg text-xs font-mono text-neutral-300 hover:text-emerald-300 transition-all flex items-center gap-1.5"
                    title={`${v.desc} (e.g. ${v.sample})`}
                  >
                    <span>{v.tag}</span>
                    {copiedTag === v.tag ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: WhatsApp Live Preview (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 bg-neutral-900 border border-neutral-800 rounded-2xl space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Eye className="w-4 h-4 text-emerald-400" />
                WhatsApp Live Preview
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyPreview}
                  disabled={!previewContent || previewLoading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
                  title="Copy preview text to clipboard"
                >
                  {copiedPreview ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400 font-semibold">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Copy Message</span>
                    </>
                  )}
                </button>
                <span className="text-[11px] text-neutral-400 bg-neutral-800/80 px-2 py-0.5 rounded">
                  Simulated Output
                </span>
              </div>
            </div>

            {/* WhatsApp Chat Bubble Mockup */}
            <div className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 min-h-[300px] flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-neutral-500 pb-2 border-b border-neutral-900">
                  <span>Channel: WinGo 1M Official</span>
                  <span>Today</span>
                </div>

                {/* WhatsApp Message Bubble */}
                <div className="bg-[#1f2c34] text-neutral-100 p-3.5 rounded-2xl rounded-tl-sm border border-emerald-900/20 shadow-md space-y-2 max-w-[95%]">
                  {previewLoading ? (
                    <div className="flex items-center gap-2 py-4 text-neutral-400 text-xs justify-center">
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                      <span>Rendering preview...</span>
                    </div>
                  ) : (
                    <pre className="text-xs font-sans whitespace-pre-wrap leading-relaxed select-text font-normal">
                      {previewContent || 'Type template text on the left to see live preview...'}
                    </pre>
                  )}

                  <div className="flex items-center justify-end gap-1 text-[10px] text-neutral-400 pt-1">
                    <span>{new Date().toTimeString().slice(0, 5)}</span>
                    <span className="text-emerald-400 font-bold">✓✓</span>
                  </div>
                </div>
              </div>

              {/* Preview info note */}
              <div className="pt-3 text-[11px] text-neutral-400 flex items-start gap-1.5 border-t border-neutral-900">
                <Info className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
                <span>
                  All placeholders like <code className="text-emerald-400">{'{issueNumber}'}</code> are dynamically replaced with real-world WinGo data at broadcast time.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
