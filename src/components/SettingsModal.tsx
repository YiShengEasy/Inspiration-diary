import React, { useState } from "react";
import { X, Eye, EyeOff, Save, Key, Cpu, HelpCircle, Globe, Settings2, Loader2, CheckCircle2, AlertTriangle, PlayCircle } from "lucide-react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  customApiKey: string;
  customGeminiBaseUrl?: string;
  selectedModel: string;
  customProvider: string;
  anthropicAuthToken: string;
  anthropicBaseUrl: string;
  anthropicModel: string;
  onSave: (config: {
    customApiKey: string;
    customGeminiBaseUrl: string;
    selectedModel: string;
    customProvider: string;
    anthropicAuthToken: string;
    anthropicBaseUrl: string;
    anthropicModel: string;
  }) => void;
}

const GEMINI_PRESET_MODELS = [
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash (Recommended Default)" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Powerful, Creative)" },
  { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash (Legacy)" },
  { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro (Legacy High Capability)" },
];

const ANTHROPIC_PRESET_MODELS = [
  { value: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet (Best Design Vision)" },
  { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku (Fast & Precise)" },
  { value: "claude-3-opus-20240229", label: "Claude 3 Opus (Rich Context)" },
];

export default function SettingsModal({
  isOpen,
  onClose,
  customApiKey,
  customGeminiBaseUrl = "",
  selectedModel,
  customProvider,
  anthropicAuthToken,
  anthropicBaseUrl,
  anthropicModel,
  onSave,
}: SettingsModalProps) {
  const [provider, setProvider] = useState(customProvider || "gemini");

  // Gemini states
  const [geminiApiKey, setGeminiApiKey] = useState(customApiKey);
  const [geminiBaseUrl, setGeminiBaseUrl] = useState(customGeminiBaseUrl);
  const [geminiModel, setGeminiModel] = useState(selectedModel || "gemini-3.5-flash");
  const [isCustomGeminiModel, setIsCustomGeminiModel] = useState(
    () => !GEMINI_PRESET_MODELS.some((p) => p.value === selectedModel)
  );
  const [customGeminiModelName, setCustomGeminiModelName] = useState(
    () => (GEMINI_PRESET_MODELS.some((p) => p.value === selectedModel) ? "" : selectedModel)
  );

  // Anthropic states
  const [anthropicToken, setAnthropicToken] = useState(anthropicAuthToken);
  const [anthropicUrl, setAnthropicUrl] = useState(anthropicBaseUrl || "https://api.anthropic.com");
  const [anthropicSelModel, setAnthropicSelModel] = useState(anthropicModel || "claude-3-5-sonnet-latest");
  const [isCustomAnthropicModel, setIsCustomAnthropicModel] = useState(
    () => !ANTHROPIC_PRESET_MODELS.some((p) => p.value === (anthropicModel || "claude-3-5-sonnet-latest"))
  );
  const [customAnthropicModelName, setCustomAnthropicModelName] = useState(
    () => (ANTHROPIC_PRESET_MODELS.some((p) => p.value === anthropicModel) ? "" : anthropicModel)
  );

  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Self-test states
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    provider: string;
    model: string;
    textStatus: { ok: boolean; error: string; response: string };
    visionStatus: { ok: boolean; error: string; response: string };
  } | null>(null);

  if (!isOpen) return null;

  const handleRunModelTest = async () => {
    setIsRunningTest(true);
    setTestResult(null);
    setTestError(null);

    const finalGeminiModel = isCustomGeminiModel ? customGeminiModelName.trim() : geminiModel;
    const finalAnthropicModel = isCustomAnthropicModel ? customAnthropicModelName.trim() : anthropicSelModel;

    const currentProvider = provider;
    const currentApiKey = currentProvider === "anthropic" ? anthropicToken.trim() : geminiApiKey.trim();
    const currentModel = currentProvider === "anthropic" ? finalAnthropicModel : finalGeminiModel;
    const currentGeminiBaseUrl = geminiBaseUrl.trim();
    const currentAnthropicBaseUrl = anthropicUrl.trim();

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-provider": currentProvider,
      };

      if (currentProvider === "anthropic") {
        if (currentApiKey) headers["x-api-key"] = currentApiKey;
        if (currentModel) headers["x-model-name"] = currentModel;
        if (currentAnthropicBaseUrl) headers["x-anthropic-base-url"] = currentAnthropicBaseUrl;
      } else {
        if (currentApiKey) headers["x-api-key"] = currentApiKey;
        if (currentModel) headers["x-model-name"] = currentModel;
        if (currentGeminiBaseUrl) headers["x-gemini-base-url"] = currentGeminiBaseUrl;
      }

      const res = await fetch("/api/test-model", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to contact diagnostic test service.");
      }

      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      console.error("Self-test failed:", err);
      setTestError(err.message || String(err));
    } finally {
      setIsRunningTest(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const finalGeminiModel = isCustomGeminiModel ? customGeminiModelName.trim() : geminiModel;
    const finalAnthropicModel = isCustomAnthropicModel ? customAnthropicModelName.trim() : anthropicSelModel;

    onSave({
      customProvider: provider,
      customApiKey: geminiApiKey.trim(),
      customGeminiBaseUrl: geminiBaseUrl.trim(),
      selectedModel: finalGeminiModel || "gemini-3.5-flash",
      anthropicAuthToken: anthropicToken.trim(),
      anthropicBaseUrl: anthropicUrl.trim() || "https://api.anthropic.com",
      anthropicModel: finalAnthropicModel || "claude-3-5-sonnet-latest",
    });

    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Dark overlay backdrop */}
      <div
        className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Settings Card dialogue */}
      <div className="relative w-full max-w-lg bg-white dark:bg-stone-900 rounded-2xl border border-amber-900/10 dark:border-stone-700/50 p-6 md:p-8 shadow-2xl z-10 transform transition-all max-h-[90vh] flex flex-col">
        {/* Background decoration faint grid */}
        <div className="absolute inset-0 pointer-events-none rounded-2xl bg-[radial-gradient(#2d2319_1px,transparent_1px)] dark:bg-[radial-gradient(#ffffff_1px,transparent_1px)] opacity-5 [background-size:16px_16px]" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors cursor-pointer z-50"
        >
          <X size={18} />
        </button>

        <div className="relative z-10 flex-1 overflow-y-auto pr-2 -mr-2">
          {/* Header */}
          <div className="flex items-center gap-2 mb-2">
            <Settings2 className="text-amber-800 dark:text-amber-400" size={18} />
            <span className="font-serif font-semibold italic text-lg text-stone-900 dark:text-stone-100">
              AI Service Configuration
            </span>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed mb-6">
            Configure custom API keys, global models, and custom third-party base endpoints to classify and generate exquisite design terminology logs.
          </p>

          {/* Provider Tabs */}
          <div className="flex border-b border-stone-200 dark:border-stone-800 mb-5">
            <button
              type="button"
              onClick={() => setProvider("gemini")}
              className={`flex-1 pb-2 text-xs font-semibold px-2 tracking-wide uppercase transition-colors border-b-2 text-center cursor-pointer ${
                provider === "gemini"
                  ? "border-amber-600 text-amber-700 dark:text-amber-400 dark:border-amber-500 font-bold"
                  : "border-transparent text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
              }`}
            >
              Google Gemini
            </button>
            <button
              type="button"
              onClick={() => setProvider("anthropic")}
              className={`flex-1 pb-2 text-xs font-semibold px-2 tracking-wide uppercase transition-colors border-b-2 text-center cursor-pointer ${
                provider === "anthropic"
                  ? "border-amber-600 text-amber-700 dark:text-amber-400 dark:border-amber-500 font-bold"
                  : "border-transparent text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
              }`}
            >
              Anthropic Claude
            </button>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            {provider === "gemini" ? (
              <>
                {/* --- Gemini Section --- */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-300 mb-1.5 flex items-center justify-between">
                    <span>Google Gemini 灵感密钥</span>
                    <span className="text-[10px] font-normal text-stone-400 lowercase italic">仅驻留在本地角落</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showGeminiKey ? "text" : "password"}
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      placeholder="悄悄粘贴你的 GEMINI_API_KEY..."
                      className="w-full px-3.5 py-2.5 text-sm bg-stone-50 dark:bg-stone-950 border border-amber-900/10 dark:border-amber-100/10 rounded-xl focus:border-amber-500 focus:outline-none pr-10 font-mono text-stone-800 dark:text-stone-200"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGeminiKey(!showGeminiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
                    >
                      {showGeminiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-700/80 dark:text-amber-400/80">
                    <HelpCircle size={12} />
                    <span>留空则意味着让系统替您唤醒默认星辉。可前往 Google AI Studio 采摘免费密钥。</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-300 mb-1.5 flex items-center justify-between">
                    <span>Gemini Base URL (Endpoint)</span>
                    <span className="text-[10px] font-normal text-stone-400 lowercase">Optional proxy / custom gateway</span>
                  </label>
                  <div className="relative flex items-center">
                    <Globe size={14} className="absolute left-3.5 text-stone-400" />
                    <input
                      type="text"
                      value={geminiBaseUrl}
                      onChange={(e) => setGeminiBaseUrl(e.target.value)}
                      placeholder="e.g. https://generativelanguage.googleapis.com"
                      className="w-full pl-9 pr-3.5 py-2.5 text-sm bg-stone-50 dark:bg-stone-950 border border-amber-900/10 dark:border-amber-100/10 rounded-xl focus:border-amber-500 focus:outline-none font-mono text-stone-800 dark:text-stone-200"
                    />
                  </div>
                  <span className="text-[10px] text-stone-400 dark:text-stone-500 block leading-relaxed mt-1">
                    Configure a high-performance regional API gateway or compatible proxy if needed.
                    <span className="block mt-1 text-[9px] text-amber-700 dark:text-amber-400 bg-amber-500/5 dark:bg-amber-500/10 p-1.5 rounded-lg border border-amber-500/10">
                      💡 <b>火山引擎/豆包提示</b>：使用火山引擎的 Vision 视觉多模态模型，Base URL 需填为完整的 responses 终结点（例如：<code>https://ark.cn-beijing.volces.com/api/v3/responses</code>），且 Model Identifier <b>必须填写推理接入点 Endpoint ID</b> (格式如 <code>ep-2025xxxxxx-xxxxx</code>)，而非多模态模型的官方系列名称（如 doubao-seed-2-0-lite）。
                    </span>
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-300 mb-1.5">
                    Gemini Model Identifier
                  </label>

                  <div className="space-y-2">
                    {!isCustomGeminiModel ? (
                      <select
                        value={geminiModel}
                        onChange={(e) => {
                          if (e.target.value === "custom") {
                            setIsCustomGeminiModel(true);
                          } else {
                            setGeminiModel(e.target.value);
                          }
                        }}
                        className="w-full px-3 py-2.5 text-sm bg-stone-50 dark:bg-stone-950 border border-amber-900/10 dark:border-amber-100/10 rounded-xl focus:border-amber-500 focus:outline-none font-sans text-stone-800 dark:text-stone-200"
                      >
                        {GEMINI_PRESET_MODELS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                        <option value="custom">✏️ Enter Custom Global Model ID...</option>
                      </select>
                    ) : (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={customGeminiModelName}
                          onChange={(e) => setCustomGeminiModelName(e.target.value)}
                          placeholder="e.g. gemini-2.0-pro-exp-02-05..."
                          className="w-full px-3.5 py-2.5 text-sm bg-stone-50 dark:bg-stone-950 border border-amber-500/55 rounded-xl focus:outline-none font-mono text-stone-800 dark:text-stone-200"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setIsCustomGeminiModel(false);
                            setGeminiModel(GEMINI_PRESET_MODELS[0].value);
                          }}
                          className="text-xs text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                        >
                          ← Back to presets list
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* --- Anthropic Section --- */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-300 mb-1.5 flex items-center justify-between">
                    <span>Anthropic Auth Token (API Key)</span>
                    <span className="text-[10px] font-normal text-stone-400 lowercase italic">saved locally</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showAnthropicKey ? "text" : "password"}
                      value={anthropicToken}
                      onChange={(e) => setAnthropicToken(e.target.value)}
                      placeholder="sk-ant-..."
                      className="w-full px-3.5 py-2.5 text-sm bg-stone-50 dark:bg-stone-950 border border-amber-900/10 dark:border-amber-100/10 rounded-xl focus:border-amber-500 focus:outline-none pr-10 font-mono text-stone-800 dark:text-stone-200"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
                    >
                      {showAnthropicKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-300 mb-1.5 flex items-center justify-between">
                    <span>Anthropic Base URL</span>
                    <span className="text-[10px] font-normal text-stone-400 lowercase">Optional proxy / custom gateway</span>
                  </label>
                  <div className="relative flex items-center">
                    <Globe size={14} className="absolute left-3.5 text-stone-400" />
                    <input
                      type="text"
                      value={anthropicUrl}
                      onChange={(e) => setAnthropicUrl(e.target.value)}
                      placeholder="https://api.anthropic.com"
                      className="w-full pl-9 pr-3.5 py-2.5 text-sm bg-stone-50 dark:bg-stone-950 border border-amber-900/10 dark:border-amber-100/10 rounded-xl focus:border-amber-500 focus:outline-none font-mono text-stone-800 dark:text-stone-200"
                    />
                  </div>
                  <span className="text-[10px] text-stone-400 dark:text-stone-500">
                    Configure your high performance third-party base proxy if required.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-300 mb-1.5">
                    Claude Model Identifier
                  </label>

                  <div className="space-y-2">
                    {!isCustomAnthropicModel ? (
                      <select
                        value={anthropicSelModel}
                        onChange={(e) => {
                          if (e.target.value === "custom") {
                            setIsCustomAnthropicModel(true);
                          } else {
                            setAnthropicSelModel(e.target.value);
                          }
                        }}
                        className="w-full px-3 py-2.5 text-sm bg-stone-50 dark:bg-stone-950 border border-amber-900/10 dark:border-amber-100/10 rounded-xl focus:border-amber-500 focus:outline-none font-sans text-stone-800 dark:text-stone-200"
                      >
                        {ANTHROPIC_PRESET_MODELS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                        <option value="custom">✏️ Enter Custom Claude Model ID...</option>
                      </select>
                    ) : (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={customAnthropicModelName}
                          onChange={(e) => setCustomAnthropicModelName(e.target.value)}
                          placeholder="e.g. claude-3-opus-20240229..."
                          className="w-full px-3.5 py-2.5 text-sm bg-stone-50 dark:bg-stone-950 border border-amber-500/55 rounded-xl focus:outline-none font-mono text-stone-800 dark:text-stone-200"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setIsCustomAnthropicModel(false);
                            setAnthropicSelModel(ANTHROPIC_PRESET_MODELS[0].value);
                          }}
                          className="text-xs text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                        >
                          ← Back to pre-configured formats
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Model Connection Diagnostic Test Area */}
            <div className="mt-6 p-4 rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <Cpu size={15} className="text-amber-700 dark:text-amber-400" />
                  <span className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                    Model Capability & Connectivity Test
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRunModelTest}
                  disabled={isRunningTest}
                  className="px-3 py-1.5 text-[11px] font-bold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-stone-300 dark:disabled:bg-stone-800 disabled:text-stone-500 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                >
                  {isRunningTest ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      <span>Testing...</span>
                    </>
                  ) : (
                    <>
                      <PlayCircle size={12} />
                      <span>Test Saved Model</span>
                    </>
                  )}
                </button>
              </div>

              {testError && (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-mono break-all mb-2">
                  <strong>API Error:</strong> {testError}
                </div>
              )}

              {isRunningTest && (
                <div className="p-3 bg-amber-500/5 border border-dashed border-amber-500/20 rounded-xl my-3 text-xs animate-pulse text-left">
                  <span className="font-serif font-bold text-amber-800 dark:text-amber-400 block mb-2 flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin text-amber-600" />
                    正在发送测试载荷 (Sending visual payload...)
                  </span>
                  <div className="grid grid-cols-3 gap-2.5 items-center">
                    <div className="col-span-1 flex flex-col items-center justify-center p-1.5 bg-white/50 dark:bg-stone-900/50 border border-dashed border-stone-300 dark:border-stone-800 rounded">
                      <span className="text-[9px] text-stone-400 block mb-1">测试图片 (16x16)</span>
                      <img 
                        src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAALElEQVR42mNk+M9QDwOMjIxtbW3E6sGlhoGBgY8bVz0yGBUYoIEBCgYGBgC3DwscLgbvggAAAABJRU5ErkJggg==" 
                        className="w-10 h-10 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 rounded p-0.5" 
                        alt="Test Loading" 
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <span className="text-[9px] text-stone-400 block">测试提示词 (Test Prompt)</span>
                      <code className="text-[11px] font-mono bg-stone-100/50 dark:bg-stone-950/50 text-amber-800 dark:text-amber-300 px-1.5 py-1 rounded block border border-amber-500/5">
                        "Reply with exactly 'OK'"
                      </code>
                    </div>
                  </div>
                </div>
              )}

              {testResult && (
                <div className="space-y-2 mt-2 font-sans text-left">
                  {/* Expose payloads */}
                  <div className="p-3 bg-stone-100 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-xl mb-3 text-xs">
                    <span className="font-serif font-bold text-stone-805 dark:text-stone-200 block mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                      已发送的测试参数
                    </span>
                    <div className="grid grid-cols-3 gap-2.5 items-center">
                      <div className="col-span-1 flex flex-col items-center justify-center p-1.5 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded">
                        <span className="text-[9px] text-stone-400 block mb-1">测试图片 (16x16)</span>
                        <img 
                          src={testResult.sentImage || "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAALElEQVR42mNk+M9QDwOMjIxtbW3E6sGlhoGBgY8bVz0yGBUYoIEBCgYGBgC3DwscLgbvggAAAABJRU5ErkJggg=="} 
                          className="w-10 h-10 border border-stone-300 dark:border-stone-700 rounded shadow-xs" 
                          alt="Tiny test" 
                        />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <span className="text-[9px] text-stone-400 block">系统测试提示词 (Test Prompt)</span>
                        <code className="text-[11px] font-mono bg-stone-50 dark:bg-stone-900 text-amber-800 dark:text-amber-300 px-1.5 py-1 rounded block border border-amber-500/10 break-all">
                          "{testResult.sentPrompt || "Reply with exactly 'OK'"}"
                        </code>
                      </div>
                    </div>
                  </div>
                  {/* Text Status Card */}
                  <div className={`p-2.5 rounded-lg text-xs border ${
                    testResult.textStatus.ok 
                      ? "bg-emerald-500/5 border-emerald-500/20 text-stone-800 dark:text-stone-200" 
                      : "bg-red-500/5 border-red-500/20 text-stone-800 dark:text-stone-200"
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                        <span>Text Response Test</span>
                      </div>
                      {testResult.textStatus.ok ? (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-0.5">
                          <CheckCircle2 size={11} /> Pass
                        </span>
                      ) : (
                        <span className="text-[10px] text-red-600 dark:text-red-400 font-bold flex items-center gap-0.5">
                          <AlertTriangle size={11} /> Fail
                        </span>
                      )}
                    </div>
                    {testResult.textStatus.ok ? (
                      <p className="text-[10px] text-stone-500 dark:text-stone-400 font-mono italic break-all">
                        Response: "{testResult.textStatus.response}"
                      </p>
                    ) : (
                      <p className="text-[10px] text-red-500 font-mono break-all mt-1 bg-red-500/10 p-1.5 rounded">
                        {testResult.textStatus.error}
                      </p>
                    )}
                  </div>

                  {/* Vision Status Card */}
                  <div className={`p-2.5 rounded-lg text-xs border ${
                    testResult.visionStatus.ok 
                      ? "bg-emerald-500/5 border-emerald-500/20 text-stone-800 dark:text-stone-200" 
                      : "bg-amber-500/5 border-amber-500/20 text-stone-800 dark:text-stone-200"
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                        <span>Image Vision Test</span>
                      </div>
                      {testResult.visionStatus.ok ? (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-0.5">
                          <CheckCircle2 size={11} /> Pass
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-600 dark:text-amber-500 font-bold flex items-center gap-0.5">
                          <AlertTriangle size={11} /> Not Supported
                        </span>
                      )}
                    </div>
                    {testResult.visionStatus.ok ? (
                      <p className="text-[10px] text-stone-500 dark:text-stone-400 font-sans">
                        Image recognized successfully by design term model.
                      </p>
                    ) : (
                      <div className="mt-1 space-y-1 text-[10px]">
                        <p className="text-amber-600 dark:text-amber-500 font-mono break-all bg-amber-500/5 p-1.5 rounded">
                          {testResult.visionStatus.error}
                        </p>
                        <div className="p-1.5 rounded bg-amber-800/10 text-amber-900 dark:text-amber-300 font-sans border border-amber-800/15 leading-relaxed text-left">
                          💡 <strong>Notice:</strong> The selected model "{testResult.model}" only supports text prompts! Since we need to identify design motifs from photographs, please select a model with vision capabilities (such as <strong>Claude 3.5 Sonnet</strong> or <strong>Gemini 3.5 Flash</strong>). Claude 3.5 Haiku is only a text model.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!testResult && !isRunningTest && (
                <p className="text-[10px] text-stone-400 mt-1 dark:text-stone-500">
                  Tests textual responses and small visual inputs on the model before returning to active diary tracking.
                </p>
              )}
            </div>

            {/* Form Footer Action */}
            <div className="pt-3 border-t border-dashed border-stone-200 dark:border-stone-800 flex justify-end gap-3.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold rounded-xl text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 cursor-pointer"
              >
                归去
              </button>

              <button
                type="submit"
                className="px-5 py-2 pb-2.5 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 shadow-md active:scale-95 transition-transform cursor-pointer"
              >
                {isSaved ? "已成行 ✓" : (
                  <>
                    <Save size={14} />
                    <span>封存设定</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
