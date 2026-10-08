import { PageBackButton } from "@/components/PageBackButton";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import privacyContent from "/privacy.md?raw";

const Privacy = () => {
  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <PageBackButton />

        <article className="markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {privacyContent}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
};

export default Privacy;
