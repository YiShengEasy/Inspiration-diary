import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Feather, Camera, Loader2, Eye, EyeOff } from "lucide-react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";
import InkReveal from "./ui/ink-reveal";

interface LoginScreenProps {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("请填写邮箱与密码 (Please fill in both)");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isLoginMode) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      onLogin();
    } catch (err: any) {
      console.error(err);
      if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
        setError("账号或密码不正确，或账户不存在 (Invalid credentials)");
      } else if (err.code === "auth/email-already-in-use") {
        setError("此邮箱已停泊在别处，尝试直接启程吧 (Email already in use)");
      } else if (err.code === "auth/weak-password") {
        setError("密码当如磐石，至少需要6个字符 (Password must be at least 6 characters)");
      } else if (err.code === "auth/invalid-email") {
        setError("邮箱格式不雅，请确认无误 (Invalid email address)");
      } else {
        setError(err.message || "云深不知处，请稍后再试 (An error occurred)");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex flex-col items-center justify-center relative overflow-hidden transition-colors duration-700">
      
      {/* Background Image to Reveal */}
      <img
        src="https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=1600&q=80"
        alt="Background Ink"
        className="absolute inset-0 w-full h-full object-cover opacity-80 dark:opacity-40 grayscale sepia-[.3] contrast-125"
      />

      {/* Light Mode Mask */}
      <InkReveal 
        maskColor={[250, 250, 249]} 
        className="dark:hidden"
      />

      {/* Dark Mode Mask */}
      <InkReveal 
        maskColor={[12, 10, 9]} 
        className="hidden dark:block"
      />
      
      {/* Visual background lines representing analog journal grid */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] dark:opacity-[0.02] bg-[linear-gradient(rgba(0,0,0,1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,1)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,1)_1px,transparent_1px)] bg-[size:24px_24px] z-10" />

      {/* Ink wash background effect */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center mix-blend-multiply dark:mix-blend-screen overflow-hidden z-10">
        <motion.div
           initial={{ scale: 0, opacity: 0, filter: "blur(10px)" }}
           animate={{ scale: 1, cursor: "default", opacity: 0.15, filter: "blur(40px)" }}
           transition={{ duration: 6, ease: "easeOut" }}
           className="absolute bg-stone-800 dark:bg-stone-400 rounded-[40%_50%_60%_40%] w-[60vmin] h-[60vmin]"
        />
        <motion.div
           initial={{ scale: 0.2, opacity: 0, filter: "blur(20px)" }}
           animate={{ scale: 1, opacity: 0.1, filter: "blur(60px)", x: 80, y: -60, rotate: 45 }}
           transition={{ duration: 8, ease: "easeOut", delay: 1 }}
           className="absolute bg-stone-900 dark:bg-stone-300 rounded-[50%_30%_60%_60%] w-[50vmin] h-[70vmin]"
        />
        <motion.div
           initial={{ scale: 0.2, opacity: 0, filter: "blur(15px)" }}
           animate={{ scale: 1, opacity: 0.08, filter: "blur(80px)", x: -100, y: 120, rotate: -30 }}
           transition={{ duration: 10, ease: "easeOut", delay: 2 }}
           className="absolute bg-stone-700 dark:bg-stone-100 rounded-[60%_70%_40%_50%] w-[70vmin] h-[50vmin]"
        />
      </div>

      <div className="relative z-20 flex flex-col items-center justify-center w-full max-w-sm px-8 min-h-[500px] pointer-events-none pb-4">
        <motion.div
           initial={{ opacity: 0, y: 30 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ duration: 1.5, ease: "easeOut", delay: 0.5 }}
           className="flex flex-col items-center gap-6 pointer-events-auto"
        >
          {/* Logo element */}
          <div className="w-14 h-14 rounded-2xl bg-amber-900/10 dark:bg-amber-100/10 flex items-center justify-center border border-amber-900/20 dark:border-amber-100/20 shadow-sm backdrop-blur-md relative overflow-hidden">
             <Camera className="text-amber-900/80 dark:text-amber-100/80 w-6 h-6 relative z-10" strokeWidth={1.5} />
          </div>
          
          {/* Title */}
          <div className="text-center space-y-1">
             <h1 className="text-xl font-serif text-stone-800 dark:text-stone-200 font-bold tracking-widest uppercase">光影拾记</h1>
             <p className="text-xs font-sans text-stone-500 dark:text-stone-400 tracking-widest uppercase mt-2">捕捉稍纵即逝的灵感与诗意</p>
          </div>
        </motion.div>

        {/* Vertical Poem */}
        <div className="mt-10 mb-8 flex flex-col items-center text-stone-800 dark:text-stone-200 font-serif font-medium h-[160px] relative pointer-events-none">
           <motion.div 
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 2, delay: 1 }}
             className="text-2xl leading-loose tracking-[0.3em] h-full flex items-center justify-center"
             style={{ writingMode: "vertical-rl", textOrientation: "upright" }}
           >
             行到水穷处
           </motion.div>
           <motion.div 
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 2, delay: 2 }}
             className="text-2xl leading-loose tracking-[0.3em] h-full flex items-center justify-center mr-8"
             style={{ writingMode: "vertical-rl", textOrientation: "upright" }}
           >
             坐看云起时
           </motion.div>
           
           <motion.div
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             transition={{ duration: 2, delay: 3 }}
             className="absolute -right-6 bottom-0 text-xs text-stone-500 dark:text-stone-400"
             style={{ writingMode: "vertical-rl", textOrientation: "upright", letterSpacing: "0.2em" }}
           >
             王维《终南别业》
           </motion.div>
        </div>

        {/* Login Form */}
        <motion.div
           initial={{ opacity: 0, filter: "blur(10px)", y: 10 }}
           animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
           transition={{ duration: 1.5, delay: 4 }}
           className="w-full relative z-30 pointer-events-auto"
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 font-sans w-full">
            <div className="flex flex-col gap-3 relative z-20">
              <input 
                type="email" 
                placeholder="邮箱 (Email)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/60 dark:bg-stone-900/60 backdrop-blur-md border border-stone-300/50 dark:border-stone-700/50 text-stone-800 dark:text-stone-200 placeholder:text-stone-500 dark:placeholder:text-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400 dark:focus:ring-stone-600 transition-all text-sm outline-none shadow-sm"
              />
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"} 
                  placeholder="密码 (Password)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-4 pr-11 py-3 rounded-xl bg-white/60 dark:bg-stone-900/60 backdrop-blur-md border border-stone-300/50 dark:border-stone-700/50 text-stone-800 dark:text-stone-200 placeholder:text-stone-500 dark:placeholder:text-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400 dark:focus:ring-stone-600 transition-all text-sm outline-none shadow-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            
            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }} 
                  animate={{ opacity: 1, height: "auto" }} 
                  exit={{ opacity: 0, height: 0 }}
                  className="text-red-800/80 dark:text-red-300/80 text-xs font-serif text-center mt-1"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-6 mt-2 rounded-2xl bg-stone-900/90 dark:bg-stone-100/90 backdrop-blur-sm text-stone-100 dark:text-stone-900 font-medium hover:bg-stone-800 dark:hover:bg-stone-200 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 border border-white/10 disabled:opacity-50 disabled:hover:translate-y-0 cursor-pointer"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Feather size={18} strokeWidth={2} />}
              <span className="tracking-widest">{isLoginMode ? "启程" : "凝结"}</span>
            </button>
            
            <button
              type="button"
              onClick={() => { setIsLoginMode(!isLoginMode); setError(null); }}
              className="mt-2 text-xs text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200 transition-colors cursor-pointer w-fit mx-auto"
            >
              {isLoginMode ? "初来乍到？造一册新卷" : "已得印记？归旧匣"}
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
