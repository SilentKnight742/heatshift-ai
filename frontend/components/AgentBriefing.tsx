import type { AnalysisResult } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function AgentBriefing({ agent }: { agent: AnalysisResult["agent"] }) {
  if (!agent) return null;

  const mode = agent.mode.replaceAll("_", " ");
  const validatedCalls = agent.tool_trace.filter((trace) => trace.success).length;

  return (
    <section className="panel agent-brief" aria-labelledby="agent-briefing-title">
      <div className="agent-brief-head">
        <div className="agent-symbol" aria-hidden="true"><span>AI</span><i /></div>
        <div>
          <span className="eyebrow">Agentic decision brief</span>
          <h2 id="agent-briefing-title">What the AI recommends</h2>
        </div>
        <span className="agent-mode-chip"><i /> {mode}</span>
      </div>
      <div className="agent-response">
        <span className="agent-response-mark" aria-hidden="true">AI</span>
        <div className="agent-response-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={(url) => /^https?:\/\//.test(url) ? url : ""}>{agent.explanation}</ReactMarkdown></div>
      </div>
      <div className="agent-brief-foot">
        <p><strong>Grounding:</strong> the schedule, risk scores, and alerts above are deterministic. The AI only explains the validated result.</p>
        <div className="agent-stat" aria-label={`${validatedCalls} validated tool calls`}>
          <strong>{validatedCalls}</strong><span>validated<br />tool calls</span>
        </div>
      </div>
    </section>
  );
}
