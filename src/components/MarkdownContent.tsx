import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownComponents: Components = {
  table: ({ node: _node, children, ...props }) => (
    <div className="my-5 max-w-full overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-700">
      <table {...props} className="min-w-full border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ node: _node, children, ...props }) => (
    <thead {...props} className="bg-stone-100 dark:bg-stone-800">
      {children}
    </thead>
  ),
  tbody: ({ node: _node, children, ...props }) => (
    <tbody {...props} className="[&_tr:last-child_td]:border-b-0">
      {children}
    </tbody>
  ),
  th: ({ node: _node, children, ...props }) => (
    <th
      {...props}
      className="whitespace-nowrap border-b border-r border-stone-200 px-4 py-2.5 font-bold text-stone-800 last:border-r-0 dark:border-stone-700 dark:text-stone-100"
    >
      {children}
    </th>
  ),
  td: ({ node: _node, children, ...props }) => (
    <td
      {...props}
      className="border-b border-r border-stone-200 px-4 py-2.5 align-top text-stone-700 last:border-r-0 dark:border-stone-700 dark:text-stone-200"
    >
      {children}
    </td>
  ),
};

export default function MarkdownContent({ children }: { children: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {children}
    </Markdown>
  );
}
