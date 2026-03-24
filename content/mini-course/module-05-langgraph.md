# Module 5: LangGraph — The Reasoning Loop
### Replace Your for Loop With a Production-Grade State Machine

**Duration:** 2 hours
**What you build:** `agent.py` and `state.py` — the complete LangGraph agent wiring together tools + memory.

---

## 5.1 Why LangGraph, Not Just a for Loop

In Module 2, you built a working agent with a simple `for` loop. It worked — but it had no way to:
- Branch differently based on what the agent discovers ("if OSPF issue go left, if BGP issue go right")
- Pause and resume (e.g., after a human approval checkpoint)
- Show you exactly what state the agent is in at any moment
- Retry a specific node without restarting from scratch

LangGraph turns your agent loop into a **directed graph of explicit state transitions**. Each node is a function. Each edge is a transition. You define exactly how data flows and when the agent moves from one phase to the next.

Think of it like a routing protocol: instead of "try everything and see what sticks," you define deterministic paths.

---

## 5.2 The Agent State

Everything the agent knows at any point in time lives in `AgentState`. Every node reads from it and writes back to it.

Create `my-network-agent/state.py`:

```python
from typing import TypedDict, List, Optional, Annotated
from enum import Enum
import operator


class AgentPhase(str, Enum):
    OBSERVE = "observe"
    REASON = "reason"
    ACT = "act"
    VERIFY = "verify"
    COMPLETE = "complete"


class ReasoningStep(TypedDict):
    phase: str
    thought: str
    action: Optional[str]
    observation: Optional[str]


class ToolCall(TypedDict):
    tool_name: str
    params: dict
    result: dict
    success: bool
    execution_time_ms: float


class AgentState(TypedDict):
    # Input
    user_query: str

    # Phase tracking
    phase: AgentPhase
    iteration: int
    max_iterations: int

    # Intelligence
    rag_context: str                        # Retrieved from ChromaDB
    reasoning_trace: List[ReasoningStep]    # Full thought log
    evidence: List[str]                     # Facts collected
    hypothesis: Optional[str]              # Current working theory
    confidence: float                       # 0.0 to 1.0

    # Actions taken
    tool_calls: List[ToolCall]
    pending_tool: Optional[dict]            # Tool waiting for human approval

    # Output
    final_answer: Optional[str]
    done: bool
```

---

## 5.3 The Prompts

The prompts are what make the agent "smart." Be specific. Use networking language.

Create `my-network-agent/prompts.py`:

```python
OBSERVE_PROMPT = """You are a network troubleshooting agent starting a new investigation.

USER QUERY: {user_query}

MEMORY CONTEXT (from past incidents and documentation):
{rag_context}

Based on this context, what do you already know about this type of problem?
What are the most likely root causes given the symptoms described?

Respond with:
INITIAL_ASSESSMENT: [what you know so far]
LIKELY_CAUSES:
  1. [most likely cause]
  2. [second most likely]
  3. [third most likely]
FIRST_CHECK: [the first thing you want to verify]
"""

REASON_PROMPT = """You are a network troubleshooting agent reasoning about your findings.

USER QUERY: {user_query}

EVIDENCE COLLECTED SO FAR:
{evidence}

CURRENT HYPOTHESIS: {hypothesis}
CURRENT CONFIDENCE: {confidence}

REASONING TRACE:
{reasoning_trace}

Based on the evidence, what is your current assessment?
What should you check next?

Respond in this EXACT format:
THOUGHT: [your reasoning about what the evidence means]
HYPOTHESIS: [your current best theory about root cause]
CONFIDENCE: [0.0 to 1.0 — how confident are you in the hypothesis]
NEXT_ACTION: [TOOL_CALL / CONCLUDE]
TOOL_NAME: [tool name if NEXT_ACTION is TOOL_CALL]
TOOL_PARAMS: {{"param": "value"}}
"""

VERIFY_PROMPT = """You are verifying your diagnosis before presenting it to the operator.

USER QUERY: {user_query}

YOUR DIAGNOSIS: {hypothesis}
CONFIDENCE: {confidence}

ALL EVIDENCE:
{evidence}

ALL TOOLS CALLED:
{tool_calls}

Review your diagnosis critically:
1. Does the evidence support it completely?
2. Did you check all obvious alternatives?
3. Is there any evidence that contradicts it?

Respond in EXACTLY this format:
VERIFIED: YES / NO / PARTIAL
CONFIDENCE_SCORE: [0.0 to 1.0]
FINAL_ANSWER: [clear, actionable diagnosis with root cause and recommended fix]
CAVEATS: [anything the operator should know / additional checks if time permits]
"""
```

---

## 5.4 The Three Core Nodes

Create `my-network-agent/agent.py`:

```python
import json
import re
import os
from typing import Literal
from langgraph.graph import StateGraph, END
from langchain_anthropic import ChatAnthropic
from state import AgentState, AgentPhase, ReasoningStep, ToolCall
from prompts import OBSERVE_PROMPT, REASON_PROMPT, VERIFY_PROMPT
from tools import build_tool_registry
from tools.safety import execute_with_approval
from memory.vector_store import NetworkKnowledgeBase

# ─────────────────────────────────────────────────────────────
# Setup
# ─────────────────────────────────────────────────────────────

llm = ChatAnthropic(model="claude-sonnet-4-6", max_tokens=2048)
tool_registry = build_tool_registry()
kb = NetworkKnowledgeBase()


# ─────────────────────────────────────────────────────────────
# Node 1: OBSERVE
# ─────────────────────────────────────────────────────────────

def observe_node(state: AgentState) -> AgentState:
    """
    First phase: gather context from memory and form initial assessment.
    This runs ONCE at the start of every investigation.
    """
    print("\n[OBSERVE] Searching memory and forming initial assessment...")

    # Pull context from ChromaDB
    rag_context = kb.get_context_for_query(state["user_query"])
    if not rag_context:
        rag_context = "No similar past incidents found in memory."

    # Ask LLM for initial assessment
    prompt = OBSERVE_PROMPT.format(
        user_query=state["user_query"],
        rag_context=rag_context,
    )
    response = llm.invoke(prompt)
    llm_output = response.content

    # Parse initial assessment
    hypothesis = ""
    first_check = ""

    if "INITIAL_ASSESSMENT:" in llm_output:
        hypothesis_match = re.search(r"INITIAL_ASSESSMENT:\s*(.+?)(?=LIKELY_CAUSES:|$)", llm_output, re.DOTALL)
        if hypothesis_match:
            hypothesis = hypothesis_match.group(1).strip()[:500]

    print(f"  Memory context: {'Found similar incidents' if 'INC-' in rag_context else 'No prior incidents'}")
    print(f"  Initial hypothesis: {hypothesis[:100]}...")

    return {
        **state,
        "phase": AgentPhase.REASON,
        "rag_context": rag_context,
        "hypothesis": hypothesis,
        "confidence": 0.2,
        "reasoning_trace": [
            ReasoningStep(
                phase="observe",
                thought=hypothesis,
                action="memory_search",
                observation=rag_context[:200],
            )
        ],
    }


# ─────────────────────────────────────────────────────────────
# Node 2: REASON
# ─────────────────────────────────────────────────────────────

def reason_node(state: AgentState) -> AgentState:
    """
    Reasoning phase: analyse evidence, update hypothesis, decide next tool to call.
    """
    print(f"\n[REASON] Iteration {state['iteration'] + 1}/{state['max_iterations']}")

    evidence_str = "\n".join(f"  - {e}" for e in state["evidence"]) or "  None yet"
    tool_calls_str = "\n".join(
        f"  - {tc['tool_name']}({tc['params']}) -> {'OK' if tc['success'] else 'FAILED'}"
        for tc in state["tool_calls"]
    ) or "  None yet"
    trace_str = "\n".join(
        f"  [{s['phase']}] {s['thought'][:100]}"
        for s in state["reasoning_trace"][-3:]  # Last 3 steps
    )

    prompt = REASON_PROMPT.format(
        user_query=state["user_query"],
        evidence=evidence_str,
        hypothesis=state["hypothesis"] or "Not yet formed",
        confidence=state["confidence"],
        reasoning_trace=trace_str,
    )

    response = llm.invoke(prompt)
    llm_output = response.content

    # Parse reasoning response
    thought = re.search(r"THOUGHT:\s*(.+?)(?=HYPOTHESIS:|$)", llm_output, re.DOTALL)
    hypothesis = re.search(r"HYPOTHESIS:\s*(.+?)(?=CONFIDENCE:|$)", llm_output, re.DOTALL)
    confidence = re.search(r"CONFIDENCE:\s*([\d.]+)", llm_output)
    next_action = re.search(r"NEXT_ACTION:\s*(\w+)", llm_output)
    tool_name = re.search(r"TOOL_NAME:\s*(\w+)", llm_output)
    tool_params = re.search(r"TOOL_PARAMS:\s*(\{.+?\})", llm_output, re.DOTALL)

    new_thought = thought.group(1).strip() if thought else llm_output[:200]
    new_hypothesis = hypothesis.group(1).strip() if hypothesis else state["hypothesis"]
    new_confidence = float(confidence.group(1)) if confidence else state["confidence"]
    action_type = next_action.group(1).strip() if next_action else "TOOL_CALL"

    print(f"  Thought: {new_thought[:100]}...")
    print(f"  Hypothesis: {new_hypothesis[:100]}...")
    print(f"  Confidence: {new_confidence:.0%}")
    print(f"  Next: {action_type}")

    # Update reasoning trace
    new_trace = state["reasoning_trace"] + [
        ReasoningStep(
            phase="reason",
            thought=new_thought,
            action=action_type,
            observation=None,
        )
    ]

    # Decide whether to act or conclude
    if action_type == "CONCLUDE" or new_confidence >= 0.85:
        return {
            **state,
            "phase": AgentPhase.VERIFY,
            "hypothesis": new_hypothesis,
            "confidence": new_confidence,
            "reasoning_trace": new_trace,
        }

    # Set up tool call
    pending_tool = None
    if tool_name:
        params = {}
        if tool_params:
            try:
                params = json.loads(tool_params.group(1))
            except json.JSONDecodeError:
                pass
        pending_tool = {"tool_name": tool_name.group(1), "params": params}

    return {
        **state,
        "phase": AgentPhase.ACT,
        "hypothesis": new_hypothesis,
        "confidence": new_confidence,
        "reasoning_trace": new_trace,
        "pending_tool": pending_tool,
        "iteration": state["iteration"] + 1,
    }


# ─────────────────────────────────────────────────────────────
# Node 3: ACT
# ─────────────────────────────────────────────────────────────

def act_node(state: AgentState) -> AgentState:
    """
    Action phase: execute the tool the reasoning node selected.
    """
    if not state.get("pending_tool"):
        print("\n[ACT] No tool to execute, returning to reason.")
        return {**state, "phase": AgentPhase.REASON}

    tool_name = state["pending_tool"]["tool_name"]
    params = state["pending_tool"]["params"]

    print(f"\n[ACT] Executing: {tool_name}({params})")

    tool = tool_registry.get(tool_name)
    if not tool:
        observation = f"ERROR: Tool '{tool_name}' not found in registry."
        result = {"success": False, "data": None, "error": observation}
    else:
        tool_result = execute_with_approval(tool, params)
        result = tool_result.to_dict()
        observation = json.dumps(result["data"], indent=2) if result["success"] else result["error"]

    print(f"  Result: {'OK' if result['success'] else 'FAILED'}")

    # Update evidence and tool call log
    new_evidence = state["evidence"] + [
        f"[{tool_name}] {observation[:300]}"
    ]
    new_tool_calls = state["tool_calls"] + [
        ToolCall(
            tool_name=tool_name,
            params=params,
            result=result,
            success=result["success"],
            execution_time_ms=0,
        )
    ]
    new_trace = state["reasoning_trace"] + [
        ReasoningStep(
            phase="act",
            thought=f"Executed {tool_name}",
            action=tool_name,
            observation=observation[:200],
        )
    ]

    return {
        **state,
        "phase": AgentPhase.REASON,
        "evidence": new_evidence,
        "tool_calls": new_tool_calls,
        "reasoning_trace": new_trace,
        "pending_tool": None,
    }


# ─────────────────────────────────────────────────────────────
# Node 4: VERIFY
# ─────────────────────────────────────────────────────────────

def verify_node(state: AgentState) -> AgentState:
    """
    Final phase: verify diagnosis, generate the complete answer.
    """
    print("\n[VERIFY] Generating final diagnosis...")

    evidence_str = "\n".join(f"  - {e}" for e in state["evidence"]) or "  No direct evidence collected."
    tool_calls_str = "\n".join(
        f"  - {tc['tool_name']}: {'success' if tc['success'] else 'failed'}"
        for tc in state["tool_calls"]
    ) or "  No tools called."

    prompt = VERIFY_PROMPT.format(
        user_query=state["user_query"],
        hypothesis=state["hypothesis"],
        confidence=state["confidence"],
        evidence=evidence_str,
        tool_calls=tool_calls_str,
    )

    response = llm.invoke(prompt)
    llm_output = response.content

    # Parse final answer
    verified = re.search(r"VERIFIED:\s*(\w+)", llm_output)
    score = re.search(r"CONFIDENCE_SCORE:\s*([\d.]+)", llm_output)
    answer = re.search(r"FINAL_ANSWER:\s*(.+?)(?=CAVEATS:|$)", llm_output, re.DOTALL)
    caveats = re.search(r"CAVEATS:\s*(.+)", llm_output, re.DOTALL)

    final_confidence = float(score.group(1)) if score else state["confidence"]
    final_answer = answer.group(1).strip() if answer else state["hypothesis"]
    if caveats:
        final_answer += f"\n\nAdditional notes: {caveats.group(1).strip()}"

    print(f"  Verification: {verified.group(1) if verified else 'PARTIAL'}")
    print(f"  Final confidence: {final_confidence:.0%}")

    return {
        **state,
        "phase": AgentPhase.COMPLETE,
        "final_answer": final_answer,
        "confidence": final_confidence,
        "done": True,
    }


# ─────────────────────────────────────────────────────────────
# Routing Functions
# ─────────────────────────────────────────────────────────────

def route_after_observe(state: AgentState) -> Literal["reason"]:
    return "reason"


def route_after_reason(state: AgentState) -> Literal["act", "verify"]:
    if state["phase"] == AgentPhase.VERIFY:
        return "verify"
    if state["iteration"] >= state["max_iterations"]:
        return "verify"
    return "act"


def route_after_act(state: AgentState) -> Literal["reason"]:
    return "reason"


def route_after_verify(state: AgentState) -> Literal["__end__"]:
    return END


# ─────────────────────────────────────────────────────────────
# Build the Graph
# ─────────────────────────────────────────────────────────────

def build_agent():
    graph = StateGraph(AgentState)

    # Add nodes
    graph.add_node("observe", observe_node)
    graph.add_node("reason", reason_node)
    graph.add_node("act", act_node)
    graph.add_node("verify", verify_node)

    # Set entry point
    graph.set_entry_point("observe")

    # Add edges
    graph.add_conditional_edges("observe", route_after_observe, {"reason": "reason"})
    graph.add_conditional_edges("reason", route_after_reason, {"act": "act", "verify": "verify"})
    graph.add_conditional_edges("act", route_after_act, {"reason": "reason"})
    graph.add_conditional_edges("verify", route_after_verify, {END: END})

    return graph.compile()


# ─────────────────────────────────────────────────────────────
# Run the Agent
# ─────────────────────────────────────────────────────────────

def run(query: str, max_iterations: int = 8) -> dict:
    agent = build_agent()

    initial_state = AgentState(
        user_query=query,
        phase=AgentPhase.OBSERVE,
        iteration=0,
        max_iterations=max_iterations,
        rag_context="",
        reasoning_trace=[],
        evidence=[],
        hypothesis=None,
        confidence=0.0,
        tool_calls=[],
        pending_tool=None,
        final_answer=None,
        done=False,
    )

    print(f"\nAgent query: '{query}'")
    print("=" * 70)

    final_state = agent.invoke(initial_state)

    print("\n" + "=" * 70)
    print("FINAL ANSWER:")
    print(final_state["final_answer"])
    print(f"\nConfidence: {final_state['confidence']:.0%}")
    print(f"Iterations: {final_state['iteration']}")
    print(f"Tools used: {[tc['tool_name'] for tc in final_state['tool_calls']]}")

    return final_state


if __name__ == "__main__":
    from memory.seed_data import seed_demo_knowledge
    seed_demo_knowledge(kb)

    run("OSPF neighbor 3.3.3.3 is stuck in INIT state on rtr-01. "
        "Users in the branch office cannot reach the data centre.")
```

---

## 5.5 Run the Full Agent

```bash
# Seed the knowledge base first
python -c "from memory.vector_store import NetworkKnowledgeBase; from memory.seed_data import seed_demo_knowledge; seed_demo_knowledge(NetworkKnowledgeBase())"

# Run the agent
python agent.py
```

You should see it progress through OBSERVE -> REASON -> ACT -> REASON -> ACT -> VERIFY, and produce a structured final answer.

---

## 5.6 The Model Router (Optional — Saves Money)

Add this to `agent.py` to route cheap queries to a local model:

```python
import os
from langchain_anthropic import ChatAnthropic
from langchain_ollama import ChatOllama   # pip install langchain-ollama

class ModelRouter:
    """
    Use local Ollama for simple queries, Claude for complex ones.
    Falls back to Claude if Ollama is unavailable.
    """
    def __init__(self, confidence_threshold: float = 0.7):
        self.threshold = confidence_threshold
        self.cloud_llm = ChatAnthropic(model="claude-sonnet-4-6")
        try:
            self.local_llm = ChatOllama(model="qwen2.5:7b", base_url="http://localhost:11434")
            self.has_local = True
        except Exception:
            self.has_local = False

    def invoke(self, prompt: str, state: AgentState = None) -> str:
        # Use local model for early iterations (less context needed)
        if self.has_local and state and state.get("confidence", 0) < self.threshold:
            try:
                response = self.local_llm.invoke(prompt)
                return response.content
            except Exception:
                pass  # Fall through to cloud

        response = self.cloud_llm.invoke(prompt)
        return response.content
```

---

## Lab 5.1: Add a New Phase

Add a `PLAN` phase before `ACT`. When the hypothesis confidence is above 0.6, the agent should:
1. Generate a list of proposed fix steps before executing any WRITE tool
2. Present the plan to the operator
3. Only proceed to ACT if the plan is approved

Hint: add a `plan_node()` and insert it between `reason` and `act`.

---

## Module 5 Quiz

1. In the routing function `route_after_reason`, what two conditions can send the agent to `verify` instead of `act`?
2. Why does the agent append to `reasoning_trace` in every node? What would break if it didn't?
3. What does `graph.compile()` do and why is it necessary?
4. The agent is stuck: `confidence` stays at 0.3 after 8 iterations. What should happen?
5. In `act_node`, if the tool returns `success=False`, the agent still adds it to `evidence`. Why is this the right behaviour?

---

## What's Next

Your agent reasons. It uses tools. It remembers. Now it needs to know about YOUR network — the live standards, the current policies, the topology. Module 6 builds the Context Layer.

**Module 6: The Context Layer — MCP and Knowledge Graph ->**


---

Module 5 · Lesson 1 — Why LangGraph

Read time: ~6 min | Module 5 of 8

---

### The Problem With Your For Loop

The agent you built in Module 2 works like this:

```python
for i in range(max_iterations):
    response = llm.call(context)
    if "DONE" in response:
        break
    execute_tool(response)
```

That loop is fine for a demo. It fails in production in four specific ways.

It cannot branch. BGP problems need different tools than OSPF problems. With a for loop, every problem goes through the same sequence. There is no way to say "BGP goes left, OSPF goes right."

It cannot pause for approval. Your agent needs to stop before pushing a config change and wait for a human. A for loop has no concept of "pause here, wait for input, then continue from exactly this point."

It cannot tell you its current state. When something fails mid-loop you cannot inspect where in the reasoning process the agent was. You have a log file and you are guessing.

It cannot retry a specific step. If iteration 3 produces garbage, you cannot replay it. You restart everything from scratch.

These are not theoretical. They are the exact failures that will happen the first time you put this agent in front of a client escalation.

---

### What LangGraph Is

LangGraph treats your agent as a directed graph. Each node is a Python function. Each edge is a routing rule.

The mental model: your agent is always in exactly one state, doing exactly one thing, and the graph tells it what to do next based on what just happened.

  OBSERVE -> REASON -> ACT -> VERIFY -> END
                        ^        |
                        +--------+  (loop back if confidence low)

That is the graph for your network troubleshooting agent. The routing logic between REASON and the next node is explicit, readable Python code — not an LLM making an uncontrolled decision about what to do next.

---

### The Networking Analogy

Think about how you handle routing in a real network. You do not configure a router and hope traffic finds its way. You define explicit policies: this prefix goes out this interface with this local-pref, this community tag redirects to this next-hop. The behavior is deterministic.

A for loop is hoping traffic finds its way. LangGraph is policy-based routing for your agent's logic.

When a client asks "how did your agent reach that conclusion?" — with LangGraph, you can show them the exact graph traversal: it observed these facts, formed this hypothesis, called these tools in this order, reached 0.87 confidence, moved to verification. Every step is named and logged.

That is auditable. That is explainable. That is what MSPs need when they are making changes to production infrastructure based on AI recommendations.

---

### The Agent State — Where Everything Lives

A LangGraph agent is stateless between nodes. Each node receives the current state, does its work, and returns an updated state. The state is the single source of truth for everything the agent knows.

```python
from typing import TypedDict, List, Optional

class AgentState(TypedDict):
    user_query:     str
    phase:          str           # "observe", "reason", "act", "verify"
    iteration:      int
    max_iterations: int
    rag_context:    str           # from ChromaDB (Module 4)
    evidence:       List[str]     # tool results accumulated so far
    hypothesis:     str           # agent's current best explanation
    confidence:     float         # 0.0 to 1.0
    tool_calls:     List[str]     # log of every tool invoked
    pending_tool:   Optional[str] # tool reason_node wants to call next
    final_answer:   str
    done:           bool
```

confidence is the key field. When it reaches 0.85 or above, the routing function sends the agent to verify. Below 0.85, it keeps collecting evidence. The confidence grows each time reason_node sees more evidence.

The state uses TypedDict not a class because LangGraph needs to serialize it to JSON for checkpointing. A TypedDict is a dict under the hood — clean serialization, no surprises.

---

Lesson 2 next: The four nodes — observe, reason, act, verify — and how to wire them into a graph.


---

Module 5 · Lesson 2 — Build the State Machine

Read time: ~8 min | Module 5 of 8

---

### How Nodes Work

Each node is a Python function that takes AgentState, does one thing, and returns only the fields that changed. LangGraph merges that dict into the state before calling the next node.

---

### observe_node — Pull Everything Before Reasoning

```python
def observe_node(state: AgentState) -> dict:
    query = state["user_query"]

    # Pull relevant docs from ChromaDB (Module 4)
    rag_results = chroma_collection.query(
        query_texts=[query], n_results=5
    )
    rag_context = "\n".join(rag_results["documents"][0])

    return {
        "phase":       "observe",
        "rag_context": rag_context,
        "evidence":    [],
        "iteration":   0,
    }
```

Runs once at the start. Pulls everything the agent needs before it starts reasoning. In Module 6 this gets extended to also pull MCP standards and topology context.

---

### reason_node — The Core

Runs after every tool call. Takes all available evidence and asks the LLM: what do I know, what is happening, how confident am I, what should I do next?

```python
def reason_node(state: AgentState) -> dict:
    evidence_text = "\n".join(state["evidence"])
    prompt = f"""
Query: {state['user_query']}
Background: {state['rag_context']}
Evidence so far:
{evidence_text}
Current hypothesis: {state['hypothesis']}

Respond in this exact format:
THOUGHT: <your reasoning>
HYPOTHESIS: <updated explanation of the problem>
CONFIDENCE: <float 0.0-1.0>
NEXT_ACTION: <tool_name|DONE>
"""
    response = llm.invoke(prompt)

    lines = {}
    for line in response.content.strip().splitlines():
        if ": " in line:
            key, value = line.split(": ", 1)
            lines[key] = value

    return {
        "phase":        "reason",
        "hypothesis":   lines.get("HYPOTHESIS", state["hypothesis"]),
        "confidence":   float(lines.get("CONFIDENCE", 0.0)),
        "pending_tool": lines.get("NEXT_ACTION", "DONE"),
        "iteration":    state["iteration"] + 1,
    }
```

The structured format (THOUGHT / HYPOTHESIS / CONFIDENCE / NEXT_ACTION) prevents the LLM from producing free-form text that is hard to parse. The evidence list grows each time act_node runs — which is how confidence increases over iterations.

---

### act_node — Execute the Tool

```python
def act_node(state: AgentState) -> dict:
    tool_name = state["pending_tool"]
    result = execute_with_approval(          # safety gate from Module 3
        tool=registry.get(tool_name),
        params={"query": state["user_query"]},
    )
    return {
        "phase":      "act",
        "evidence":   state["evidence"] + [f"[{tool_name}]: {result}"],
        "tool_calls": state["tool_calls"] + [tool_name],
    }
```

Reads the pending tool from state, calls the safety gate you built in Module 3, appends the tool result to the evidence list. Returns only the changed fields.

---

### verify_node — Final Answer

```python
def verify_node(state: AgentState) -> dict:
    prompt = f"""
You are finalizing a network troubleshooting report.
Query: {state['user_query']}
Hypothesis: {state['hypothesis']}
Evidence: {chr(10).join(state['evidence'])}
Confidence: {state['confidence']}

Write a final answer with:
1. Root cause (one sentence)
2. Evidence summary (bullet points)
3. Recommended action
4. Caveats (what could not be verified)
"""
    response = llm.invoke(prompt)
    return {
        "phase":        "verify",
        "final_answer": response.content.strip(),
        "done":         True,
    }
```

---

### Wire the Graph

```python
from langgraph.graph import StateGraph, END

def route_after_reason(state: AgentState) -> str:
    if state["done"]:                                  return "verify"
    if state["confidence"] >= 0.85:                    return "verify"
    if state["iteration"] >= state["max_iterations"]:  return "verify"
    if state["pending_tool"] == "DONE":                return "verify"
    return "act"


def build_agent():
    graph = StateGraph(AgentState)

    graph.add_node("observe", observe_node)
    graph.add_node("reason",  reason_node)
    graph.add_node("act",     act_node)
    graph.add_node("verify",  verify_node)

    graph.set_entry_point("observe")
    graph.add_edge("observe", "reason")
    graph.add_edge("act",     "reason")     # act always loops back to reason
    graph.add_edge("verify",  END)

    graph.add_conditional_edges("reason", route_after_reason)

    return graph.compile()
```

The routing function is the entire branching logic of your agent. Twelve lines of Python. Readable. Testable. Not hidden inside a prompt.

---

### Run It

```python
agent = build_agent()

initial_state = {
    "user_query":     "OSPF adjacency flapping on R1 every 90 seconds",
    "phase":          "init",
    "iteration":      0,
    "max_iterations": 6,
    "rag_context":    "",
    "evidence":       [],
    "hypothesis":     "",
    "confidence":     0.0,
    "tool_calls":     [],
    "pending_tool":   None,
    "final_answer":   "",
    "done":           False,
}

result = agent.invoke(initial_state)
print(result["final_answer"])
print(f"Confidence: {result['confidence']:.2f}")
print(f"Tools used: {', '.join(result['tool_calls'])}")
```

Compare the output to your Module 2 for-loop agent. Same query. Structured output. Named phases. Confidence score. Every tool call visible.

---

Module Challenge: Post in #agent-builds:
1. How many iterations to reach the confidence threshold?
2. What tools did it call, in order?
3. Final confidence score?
