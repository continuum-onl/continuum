import { PageBackButton } from "@/components/PageBackButton";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import termsContent from "/terms.md?raw";

export default function Terms() {
  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <PageBackButton />

        <article className="markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {termsContent}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
