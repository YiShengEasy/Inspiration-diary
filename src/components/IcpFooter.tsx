const ICP_RECORD_NUMBER = "浙ICP备2026053456号";
const ICP_RECORD_URL = "https://beian.miit.gov.cn/";

export default function IcpFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer
      className={`relative z-20 flex justify-center px-4 text-center text-[11px] text-stone-500/80 dark:text-stone-400/80 ${
        compact ? "pb-4" : "pb-5 pt-2"
      }`}
    >
      <a
        href={ICP_RECORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm underline-offset-4 transition-colors hover:text-stone-800 hover:underline focus:outline-none focus:ring-2 focus:ring-amber-500/40 dark:hover:text-stone-100"
      >
        {ICP_RECORD_NUMBER}
      </a>
    </footer>
  );
}
