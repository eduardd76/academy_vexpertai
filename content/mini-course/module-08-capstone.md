# Module 8: Capstone — The Complete OSPF Troubleshooting Agent
### Wire Everything Together Into One Runnable Agent

**Duration:** 2 hours
**What you build:** A fully functional AI agent that troubleshoots OSPF neighbor issues end-to-end — diagnosis, fix proposal, human approval, and verification.

---

## 8.1 What You Are Building

This capstone wires together everything from Modules 1-7 into a single deployable agent.

**Scenario:** An operator reports: *"OSPF neighbor 3.3.3.3 on rtr-01 has been stuck in INIT state for 20 minutes. Branch office users cannot access the data centre."*

**The agent will:**
1. Search memory for similar past incidents (Module 4)
2. Pull network standards from MCP (Module 6)
3. Get topology context for rtr-01 (Module 6)
4. Execute show commands autonomously (Module 3)
5. Reason about the evidence to form a hypothesis (Module 5)
6. Identify root cause: OSPF area mismatch
7. Generate a config fix using reflection (Module 1)
8. Present the fix for human approval (Module 7)
9. Apply the fix after approval (Module 3)
10. Verify the neighbor came up (Module 5)

---

## 8.2 Complete File Structure

```
my-network-agent/
├── .env
├── requirements.txt
├── config.py
├── state.py
├── prompts.py
├── agent.py
├── observability.py
├── tools/
│   ├── __init__.py
│   ├── base.py
│   ├── safety.py
│   ├── show_command.py
│   ├── config_push.py
│   └── netbox.py
├── memory/
│   ├── __init__.py
│   ├── vector_store.py
│   └── seed_data.py
└── context/
    ├── mcp_client.py
    └── graph_store.py
```

---

## 8.3 requirements.txt

```text
# AI / Agent
anthropic>=0.34.0
langchain>=0.3.0
langgraph>=0.2.0
langchain-anthropic>=0.2.0
langchain-ollama>=0.2.0    # optional — for local model

# Memory
chromadb>=0.5.0

# Network tools
netmiko>=4.3.0
napalm>=5.0.0              # optional — higher-level network API
requests>=2.31.0

# Context layer
fastapi>=0.111.0
uvicorn>=0.30.0

# Neo4j (optional)
neo4j>=5.0.0

# Observability
prometheus-client>=0.20.0

# Utilities
python-dotenv>=1.0.0
pydantic>=2.0.0
```

Install:
```bash
pip install -r requirements.txt
```

---

## 8.4 The Capstone Agent Script

Create `my-network-agent/capstone/ospf_agent.py`:

```python
"""
OSPF Troubleshooting Agent — Capstone
Demonstrates the complete agent loop from diagnosis to verification.
"""

import os
import sys
import time
import json

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import os
os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
os.environ.setdefault("LANGCHAIN_PROJECT", "ospf-troubleshooting-agent")

from langchain_anthropic import ChatAnthropic
from langgraph.graph import StateGraph, END

from state import AgentState, AgentPhase, ReasoningStep, ToolCall
from memory.vector_store import NetworkKnowledgeBase
from memory.seed_data import seed_demo_knowledge
from tools import build_tool_registry
from tools.safety import execute_with_approval
from context.mcp_client import get_mcp_context_for_prompt, is_change_freeze_active
from context.graph_store import NetworkGraphStore

# ─────────────────────────────────────────────────────────────
# Initialise dependencies
# ─────────────────────────────────────────────────────────────

print("Initialising agent dependencies...")
llm = ChatAnthropic(model="claude-sonnet-4-6", max_tokens=2048)
tool_registry = build_tool_registry()
kb = NetworkKnowledgeBase()
graph_store = NetworkGraphStore()

# Seed knowledge base (idempotent — safe to run every time)
seed_demo_knowledge(kb)
print("Knowledge base ready.")


# ─────────────────────────────────────────────────────────────
# Prompts tailored for OSPF troubleshooting
# ─────────────────────────────────────────────────────────────

OSPF_OBSERVE_PROMPT = """You are a senior network engineer specialising in OSPF troubleshooting.

USER QUERY: {user_query}

MEMORY CONTEXT (similar past incidents and relevant facts):
{rag_context}

NETWORK TOPOLOGY:
{topology_context}

NETWORK STANDARDS (from MCP):
{mcp_context}

Given this context, analyse the OSPF problem:

1. What OSPF state is mentioned and what does it indicate?
2. Based on past incidents and the OSPF state machine, what are the top 3 likely root causes?
3. What is the most efficient first check (Layer 1 first, then protocol)?

INITIAL_ASSESSMENT: [your analysis of the problem]
LIKELY_CAUSES:
  1. [most likely — based on memory context if available]
  2. [second most likely]
  3. [third most likely]
FIRST_CHECK: [specific tool and command to start with]
"""

OSPF_REASON_PROMPT = """You are troubleshooting an OSPF problem. Continue your systematic investigation.

ORIGINAL QUERY: {user_query}

EVIDENCE COLLECTED:
{evidence}

CURRENT HYPOTHESIS: {hypothesis}
CONFIDENCE: {confidence}

RECENT REASONING:
{reasoning_trace}

AVAILABLE TOOLS:
{tool_descriptions}

Based on the evidence:
- If you have found the root cause with confidence >= 0.85, respond with NEXT_ACTION: CONCLUDE
- Otherwise, identify the SINGLE most valuable next tool to call

THOUGHT: [your analysis of the current evidence]
HYPOTHESIS: [updated root cause theory]
CONFIDENCE: [0.0 to 1.0]
NEXT_ACTION: TOOL_CALL or CONCLUDE
TOOL_NAME: [exact tool name]
TOOL_PARAMS: {{"param": "value"}}
"""

OSPF_FIX_PROMPT = """You are generating a configuration fix for a confirmed OSPF issue.

CONFIRMED ROOT CAUSE: {root_cause}
DEVICE: {device}
EVIDENCE: {evidence}

NETWORK STANDARDS:
{mcp_context}

Generate the MINIMAL configuration change that fixes this issue.
Ensure the fix follows the network standards above.

Use Reflection: first generate the fix, then critique it, then produce the final version.

GENERATED FIX:
[initial fix]

REFLECTION CRITIQUE:
[critique the fix for: correctness, standards compliance, security, blast radius]

FINAL FIX (Cisco IOS format):
[final, corrected configuration lines]

RISK_LEVEL: LOW / MEDIUM / HIGH
EXPLANATION: [what this change does and why it is safe]
"""

OSPF_VERIFY_PROMPT = """Verify whether the OSPF problem has been resolved.

ORIGINAL PROBLEM: {original_query}
FIX APPLIED: {fix_applied}

VERIFICATION EVIDENCE:
{evidence}

Has the problem been resolved?

VERIFIED: YES / NO / PARTIAL
CONFIDENCE_SCORE: [0.0 to 1.0]
FINAL_ANSWER: [complete summary: what was wrong, what was done, current state]
NEXT_STEPS: [any remaining actions or monitoring recommendations]
"""


# ─────────────────────────────────────────────────────────────
# Nodes
# ─────────────────────────────────────────────────────────────

def observe_node(state: AgentState) -> AgentState:
    print("\n" + "=" * 60)
    print("[PHASE: OBSERVE] Building initial context...")

    # Memory search
    rag_context = kb.get_context_for_query(state["user_query"])

    # Topology context — detect device from query
    device_mentioned = None
    query_words = state["user_query"].lower().split()
    for word in query_words:
        word = word.strip(".,:")
        if any(word.startswith(prefix) for prefix in ["rtr-", "sw-", "fw-", "core-", "dist-"]):
            device_mentioned = word
            break

    topology_context = ""
    if device_mentioned:
        topology_context = graph_store.get_topology_context(device_mentioned)
        print(f"  Topology context loaded for: {device_mentioned}")

    mcp_context = get_mcp_context_for_prompt()
    frozen = is_change_freeze_active()
    if frozen:
        print("  !! CHANGE FREEZE ACTIVE — agent will not propose changes !!")

    # Initial assessment
    prompt = OSPF_OBSERVE_PROMPT.format(
        user_query=state["user_query"],
        rag_context=rag_context or "No similar incidents found.",
        topology_context=topology_context or "No topology data available.",
        mcp_context=mcp_context,
    )

    response = llm.invoke(prompt)
    initial_assessment = response.content

    print(f"  Memory: {'Similar incidents found' if 'INC-' in rag_context else 'No prior incidents'}")
    print(f"  Change freeze: {'YES' if frozen else 'No'}")

    return {
        **state,
        "phase": AgentPhase.REASON,
        "rag_context": "\n\n".join(filter(None, [rag_context, topology_context, mcp_context])),
        "hypothesis": initial_assessment[:500],
        "confidence": 0.2,
        "reasoning_trace": [
            ReasoningStep(
                phase="observe",
                thought=initial_assessment[:300],
                action="memory+topology+mcp",
                observation="Context loaded",
            )
        ],
    }


def reason_node(state: AgentState) -> AgentState:
    import re
    print(f"\n[PHASE: REASON] Iteration {state['iteration'] + 1}/{state['max_iterations']}")

    evidence_str = "\n".join(f"  - {e[:200]}" for e in state["evidence"]) or "  None yet"
    trace_str = "\n".join(
        f"  {s['thought'][:120]}"
        for s in state["reasoning_trace"][-3:]
    )

    prompt = OSPF_REASON_PROMPT.format(
        user_query=state["user_query"],
        evidence=evidence_str,
        hypothesis=state["hypothesis"] or "Not yet formed",
        confidence=state["confidence"],
        reasoning_trace=trace_str,
        tool_descriptions=tool_registry.descriptions_for_prompt(),
    )

    response = llm.invoke(prompt)
    llm_output = response.content

    # Parse
    thought = re.search(r"THOUGHT:\s*(.+?)(?=HYPOTHESIS:|$)", llm_output, re.DOTALL)
    hypothesis = re.search(r"HYPOTHESIS:\s*(.+?)(?=CONFIDENCE:|$)", llm_output, re.DOTALL)
    confidence = re.search(r"CONFIDENCE:\s*([\d.]+)", llm_output)
    next_action = re.search(r"NEXT_ACTION:\s*(\w+)", llm_output)
    tool_name = re.search(r"TOOL_NAME:\s*(\w+)", llm_output)
    tool_params = re.search(r"TOOL_PARAMS:\s*(\{.+?\})", llm_output, re.DOTALL)

    new_thought = thought.group(1).strip() if thought else ""
    new_hypothesis = hypothesis.group(1).strip() if hypothesis else state["hypothesis"]
    new_confidence = float(confidence.group(1)) if confidence else state["confidence"]
    action_type = next_action.group(1).upper() if next_action else "TOOL_CALL"

    print(f"  Hypothesis: {new_hypothesis[:100]}...")
    print(f"  Confidence: {new_confidence:.0%} | Next: {action_type}")

    new_trace = state["reasoning_trace"] + [
        ReasoningStep(phase="reason", thought=new_thought, action=action_type, observation=None)
    ]

    if action_type == "CONCLUDE" or new_confidence >= 0.85:
        return {**state, "phase": AgentPhase.VERIFY, "hypothesis": new_hypothesis,
                "confidence": new_confidence, "reasoning_trace": new_trace}

    pending_tool = None
    if tool_name:
        params = {}
        if tool_params:
            try:
                params = json.loads(tool_params.group(1))
            except Exception:
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


def act_node(state: AgentState) -> AgentState:
    if not state.get("pending_tool"):
        return {**state, "phase": AgentPhase.REASON}

    tool_name = state["pending_tool"]["tool_name"]
    params = state["pending_tool"]["params"]

    print(f"\n[PHASE: ACT] {tool_name}({params})")

    tool = tool_registry.get(tool_name)
    if not tool:
        observation = f"ERROR: Unknown tool '{tool_name}'"
        result = {"success": False, "data": None, "error": observation}
    else:
        tool_result = execute_with_approval(tool, params)
        result = tool_result.to_dict()
        observation = json.dumps(result.get("data"), indent=2) if result["success"] else result.get("error", "")

    print(f"  {'OK' if result['success'] else 'FAILED'}: {str(observation)[:150]}")

    return {
        **state,
        "phase": AgentPhase.REASON,
        "evidence": state["evidence"] + [f"[{tool_name}] {str(observation)[:300]}"],
        "tool_calls": state["tool_calls"] + [
            ToolCall(tool_name=tool_name, params=params, result=result,
                     success=result["success"], execution_time_ms=0)
        ],
        "reasoning_trace": state["reasoning_trace"] + [
            ReasoningStep(phase="act", thought=f"Called {tool_name}", action=tool_name,
                          observation=str(observation)[:200])
        ],
        "pending_tool": None,
    }


def verify_node(state: AgentState) -> AgentState:
    import re
    print("\n[PHASE: VERIFY] Generating final diagnosis...")

    evidence_str = "\n".join(f"  - {e[:200]}" for e in state["evidence"])
    fix_applied = next(
        (str(tc["params"]) for tc in state["tool_calls"] if tc["tool_name"] == "push_config"),
        "No configuration changes applied"
    )

    prompt = OSPF_VERIFY_PROMPT.format(
        original_query=state["user_query"],
        fix_applied=fix_applied,
        evidence=evidence_str or "No direct evidence collected.",
    )

    response = llm.invoke(prompt)
    llm_output = response.content

    score = re.search(r"CONFIDENCE_SCORE:\s*([\d.]+)", llm_output)
    answer = re.search(r"FINAL_ANSWER:\s*(.+?)(?=NEXT_STEPS:|$)", llm_output, re.DOTALL)

    final_confidence = float(score.group(1)) if score else state["confidence"]
    final_answer = answer.group(1).strip() if answer else state["hypothesis"]

    return {
        **state,
        "phase": AgentPhase.COMPLETE,
        "final_answer": final_answer,
        "confidence": final_confidence,
        "done": True,
    }


# ─────────────────────────────────────────────────────────────
# Graph Assembly
# ─────────────────────────────────────────────────────────────

def build_ospf_agent():
    graph = StateGraph(AgentState)

    graph.add_node("observe", observe_node)
    graph.add_node("reason", reason_node)
    graph.add_node("act", act_node)
    graph.add_node("verify", verify_node)

    graph.set_entry_point("observe")

    graph.add_edge("observe", "reason")

    graph.add_conditional_edges("reason", lambda s: (
        "verify" if s["phase"] == AgentPhase.VERIFY or s["iteration"] >= s["max_iterations"]
        else "act"
    ), {"verify": "verify", "act": "act"})

    graph.add_edge("act", "reason")
    graph.add_edge("verify", END)

    return graph.compile()


# ─────────────────────────────────────────────────────────────
# Main Entry Point
# ─────────────────────────────────────────────────────────────

def run_ospf_agent(query: str, max_iterations: int = 8) -> dict:
    agent = build_ospf_agent()

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

    start = time.time()
    final_state = agent.invoke(initial_state)
    elapsed = time.time() - start

    print("\n" + "=" * 60)
    print("AGENT DIAGNOSIS COMPLETE")
    print("=" * 60)
    print(f"\n{final_state['final_answer']}")
    print(f"\nConfidence : {final_state['confidence']:.0%}")
    print(f"Iterations : {final_state['iteration']}")
    print(f"Time       : {elapsed:.1f}s")
    print(f"Tools used : {[tc['tool_name'] for tc in final_state['tool_calls']]}")

    return final_state


if __name__ == "__main__":
    # Run the capstone scenario
    result = run_ospf_agent(
        query=(
            "OSPF neighbor 3.3.3.3 on rtr-01 has been stuck in INIT state for 20 minutes. "
            "Branch office users cannot access the data centre. "
            "This is impacting approximately 50 users."
        )
    )
```

---

## 8.5 Run the Capstone

```bash
# From the my-network-agent directory
python capstone/ospf_agent.py
```

**What you should see:**
```
Initialising agent dependencies...
Knowledge base ready.

============================================================
[PHASE: OBSERVE] Building initial context...
  Memory: Similar incidents found
  Change freeze: No

[PHASE: REASON] Iteration 1/8
  Hypothesis: OSPF INIT state indicates one-way communication...
  Confidence: 35% | Next: TOOL_CALL

[PHASE: ACT] run_show_command({'device': 'rtr-01', 'command': 'show ip ospf neighbor'})
  OK: {"neighbors": [{"neighbor_id": "3.3.3.3", "state": "INIT", ...}]}

[PHASE: REASON] Iteration 2/8
  Hypothesis: L1/L2 appears OK, checking OSPF configuration...
  Confidence: 45% | Next: TOOL_CALL

[PHASE: ACT] run_show_command({'device': 'rtr-01', 'command': 'show ip ospf interface gi0/1'})
  OK: {"area": "1", "hello_interval": 10, ...}

[PHASE: REASON] Iteration 3/8
  Hypothesis: Area mismatch! rtr-01 Gi0/1 is in area 1, should be area 0
  Confidence: 89% | Next: CONCLUDE

[PHASE: VERIFY] Generating final diagnosis...

============================================================
AGENT DIAGNOSIS COMPLETE
============================================================

ROOT CAUSE: OSPF area mismatch on rtr-01 GigabitEthernet0/1.
The interface is configured in OSPF area 1, but the neighbor 3.3.3.3 is in the backbone area 0.
OSPF INIT state occurs when Hellos are received but our Router ID does not appear in the
neighbor's Hello packet — typically caused by area mismatch.

RECOMMENDED FIX:
  interface GigabitEthernet0/1
   ip ospf 1 area 0

CONTEXT FROM MEMORY: Similar to INC-2089 (firewall ACL blocking multicast) — however
in this case L1/L2 is confirmed UP and multicast is not the issue. Area mismatch is confirmed.

RISK: Low — non-disruptive OSPF configuration change.
VERIFICATION: After applying the fix, verify with 'show ip ospf neighbor' that 3.3.3.3
reaches FULL state within 40 seconds.

Confidence : 89%
Iterations : 3
Time       : 18.4s
Tools used : ['run_show_command', 'run_show_command']
```

---

## 8.6 Extend the Capstone (Challenge Exercises)

### Challenge 1: Multi-Protocol Support
Add BGP troubleshooting tools and test with:
```
"BGP neighbor 192.168.100.1 on border-rtr-01 is in Active state"
```

### Challenge 2: Automated Fix Application
After the human approves the fix, have the agent:
1. Push the config
2. Wait 45 seconds
3. Run `show ip ospf neighbor` to verify FULL state
4. Report success or escalate

### Challenge 3: Multi-Device Scenario
Expand the demo data so rtr-02 also has a misconfiguration. Test:
```
"Multiple OSPF neighbors are down across the network following the maintenance window last night"
```
The agent should investigate multiple devices and identify all issues.

### Challenge 4: Real Device Connection
Swap `DEMO_MODE = False` in `tools/show_command.py` and connect to a real device or GNS3/EVE-NG lab. You will need:
- Real device credentials in `.env`
- Accessible management IP
- Read-only SSH user configured

---

## 8.7 Course Completion Summary

You have built a production-grade AI agent for network operations. Here is what you built across the 8 modules:

| Module | What You Built | Where It Lives |
|--------|----------------|----------------|
| 1 | Mental model + design patterns | Your head |
| 2 | ReAct loop from scratch | `simple_agent.py` |
| 3 | Tool layer + safety gate | `tools/` |
| 4 | ChromaDB knowledge base | `memory/` |
| 5 | LangGraph state machine | `agent.py`, `state.py` |
| 6 | MCP server + topology graph | `context/` |
| 7 | Observability + production checklist | `observability.py`, `agent_audit.log` |
| 8 | Complete OSPF troubleshooting agent | `capstone/ospf_agent.py` |

### What Makes This Agent Good

1. **It reasons, not just executes** — uses a real LLM reasoning loop, not if-then rules
2. **It remembers** — past incidents inform current investigations
3. **It is grounded** — MCP standards and topology prevent hallucinated advice
4. **It is safe** — every WRITE operation requires human approval + audit log
5. **It is observable** — every decision is visible in LangSmith
6. **It is deterministic** — LangGraph ensures predictable, auditable state transitions

### What to Build Next

- Add more protocols: BGP, VXLAN EVPN, MPLS
- Connect to your real NetBox and Neo4j instances
- Feed real incident tickets into the knowledge base
- Add a Slack or Teams integration (receive alerts, respond with diagnosis)
- Build a web UI using Streamlit or Chainlit
- Fine-tune a local model on your network-specific data for faster, cheaper inference

---

## Final Quiz

1. In the capstone agent, why does `observe_node` load three types of context (RAG, topology, MCP) before any reasoning?
2. The agent found the root cause in 3 iterations. What would cause it to need 8 iterations instead?
3. If you wanted to add VXLAN troubleshooting, what four things would you need to add?
4. Your manager asks: "Why do we need LangGraph instead of just a for loop?" Give a 2-sentence answer.
5. You deploy the agent to production. Three weeks later, operators stop using it. What are the three most likely reasons and how do you address each?

---

## Congratulations

You have gone from zero to a working, production-grade AI agent for network operations.

The agent you built embodies a principle that experienced network engineers already live by: **diagnose systematically, verify every assumption, never change production without a plan.**

The difference is that now you have a system that does this at scale, at any hour, and remembers every lesson your team has ever learned.

*"AI agents don't replace network engineers. They make network engineers superhuman."*
— Eduard Dulharu, vExpertAI GmbH


---

Module 8 · Lesson 1 — The Scenario: End to End

Read time: ~6 min | Module 8 of 8 — Capstone

---

### You Have Built Every Piece

The LLM wrapper. The tool layer with safety gate. The ChromaDB memory. The MCP standards server. The topology graph. The LangGraph state machine. The audit log and observability.

This module wires them together into one agent that runs a real incident from first observation to verified fix.

---

### The Incident

  OSPF neighbor 3.3.3.3 on client-rtr-01 has been stuck in INIT state for 20 minutes.
  50 users at the branch office cannot reach the data centre.

This is not a contrived lab scenario. This is a ticket that comes in at 14:37 on a Tuesday. Your engineer picks it up, starts running show ip ospf neighbor, cross-references the area config, checks timers, pulls the topology map. Twenty minutes later: area mismatch. Area 0 on one side, area 1 on the other. A config change pushed last Thursday.

Twenty minutes. One engineer. Fifty users offline.

The agent does it in under two minutes.

---

### What the Agent Does: The Full Execution Path

Step 1 — OBSERVE
Receives: neighbor IP 3.3.3.3, device client-rtr-01, state INIT, duration 20 minutes.

Step 2 — MEMORY SEARCH
Before touching the router, queries ChromaDB. Any past incidents with this neighbor? Known area assignments for this site? Similarity 0.87 match found: INC-1955, OSPF area mismatch after VLAN change.

Step 3 — TOPOLOGY LOOKUP
Queries the graph store. What is client-rtr-01 connected to? What is the expected OSPF area for the link toward 3.3.3.3?

Step 4 — MCP CHECK
Calls the MCP server. Change window open for this client? Credentials valid?

Step 5 — RUN SHOW COMMANDS (READ — auto-execute)
- show ip ospf neighbor detail
- show ip ospf interface GigabitEthernet0/1
- show ip ospf

Step 6 — REASON
LLM receives full context: topology expectation, memory hits, live show output. Identifies local interface in area 0, neighbor expects area 1. Confidence: 94%.

Step 7 — PROPOSE FIX

  interface GigabitEthernet0/1
    ip ospf 1 area 1

Does not apply it. Packages the fix with reasoning and confidence score.

Step 8 — HUMAN APPROVAL (WRITE — must pause)
Agent stops. Posts proposed change to console. Engineer reviews. Approves.

Step 9 — APPLY
Pushes the config change. Logs with timestamp, device, interface, and operator name.

Step 10 — VERIFY
Waits 30 seconds. Re-runs show ip ospf neighbor. Checks whether 3.3.3.3 moved from INIT to FULL. FULL: resolved. Not FULL: escalates with full diagnostic trace.

---

### Why It Takes the Agent Under Two Minutes

  Task                              | Engineer  | Agent
  Log in, navigate to neighbor      | 3 min     | 0 (MCP pre-authenticated)
  Run show commands                 | 4 min     | 4 seconds
  Search runbooks + past tickets    | 7 min     | 2 seconds (ChromaDB)
  Cross-reference topology          | 3 min     | 1 second (graph query)
  Formulate and write fix           | 2 min     | 8 seconds (LLM reasoning)
  Apply and verify                  | 1 min     | 35 seconds (30s wait + re-check)

The engineer is not slow. The tools are slow. The agent's tools are fast.

---

Lesson 2 next: The complete agent assembly — all pieces wired into a single running file.


---

Module 8 · Lesson 2 — The Complete Agent: Assembly

Read time: ~8 min | Module 8 of 8 — Capstone

---

### The Import Block Tells the Story

```python
# Module 2 — LLM
from langchain_anthropic import ChatAnthropic

# Module 4 — Memory
from tools.memory_tools import search_kb, store_to_kb

# Module 3 — Tools + safety gate
from tools.ospf_tools import get_ospf_neighbors, get_ospf_interface, push_config_change

# Module 5 — State + Graph
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from state import OSPFAgentState
```

No new dependencies. Everything here you have already built and tested.

---

### The Prompts (prompts.py)

Prompts live in their own file, not inline in nodes. This makes them testable and swappable.

```python
REASON_PROMPT = """
You are an OSPF troubleshooting agent for a managed service provider.

Incident: OSPF neighbor {neighbor_ip} on {device} stuck in {neighbor_state} for {duration_minutes} minutes.

Show command output:
{show_output}

Topology context:
{topology}

Past incidents from knowledge base:
{kb_hits}

Diagnose the root cause. Return a JSON object with keys:
  root_cause   — one sentence
  evidence     — bullet points referencing specific show output
  config_fix   — exact IOS config change required
  confidence   — float 0.0 to 1.0

Return only the JSON object. No explanation.
"""
```

All prompts return structured JSON. temperature=0 on the LLM — you want deterministic reasoning on a live network, not creative output.

---

### The Four Nodes

```python
import json, time

def observe(state: OSPFAgentState) -> dict:
    kb_hits  = search_kb(f"ospf neighbor {state['neighbor_ip']} {state['device']}")
    topology = get_device_topology(state["device"])
    prompt   = OBSERVE_PROMPT.format(**state, kb_hits=json.dumps(kb_hits),
                                     topology=json.dumps(topology))
    commands = json.loads(llm.invoke(prompt).content)["commands"]

    show_output = {}
    for cmd in commands:
        show_output[cmd] = get_ospf_neighbors(state["device"], cmd)

    return {"kb_hits": kb_hits, "topology": topology,
            "show_output": show_output, "iterations": state["iterations"] + 1}


def reason(state: OSPFAgentState) -> dict:
    prompt  = REASON_PROMPT.format(**state, show_output=json.dumps(state["show_output"]),
                                   topology=json.dumps(state["topology"]),
                                   kb_hits=json.dumps(state["kb_hits"]))
    result  = json.loads(llm.invoke(prompt).content)

    # Store this diagnosis for future incidents
    store_to_kb(
        text=f"Incident: {state['device']} neighbor {state['neighbor_ip']} "
             f"INIT state. Root cause: {result['root_cause']}",
        metadata={"device": state["device"], "type": "incident_diagnosis"}
    )
    return {"diagnosis":    result["root_cause"],
            "proposed_fix": result["config_fix"],
            "confidence":   float(result["confidence"])}


def act(state: OSPFAgentState) -> dict:
    print(f"\n--- PROPOSED FIX ---")
    print(f"Device:     {state['device']}")
    print(f"Diagnosis:  {state['diagnosis']}")
    print(f"Confidence: {state['confidence']:.0%}")
    print(f"\nConfig change:\n{state['proposed_fix']}")
    print(f"--------------------")

    if input("\nApprove this change? (yes/no): ").strip().lower() != "yes":
        print("Change rejected. Escalating to engineer queue.")
        return {"approved": False, "applied": False}

    push_config_change(state["device"], state["proposed_fix"])
    return {"approved": True, "applied": True}


def verify(state: OSPFAgentState) -> dict:
    print("\nWaiting 30 seconds for OSPF convergence...")
    time.sleep(30)
    post_fix = get_ospf_neighbors(state["device"], "show ip ospf neighbor detail")
    result   = json.loads(llm.invoke(VERIFY_PROMPT.format(
        **state, post_fix_output=json.dumps(post_fix)
    )).content)

    if result["resolved"]:
        print(f"\nResolved. Neighbor {state['neighbor_ip']} is now {result['current_state']}.")
    else:
        print(f"\nNot resolved. State: {result['current_state']}. Escalating.")

    return {"verified": result["resolved"]}
```

---

### Wire the Graph

```python
def route_after_reason(state: OSPFAgentState) -> str:
    if state["confidence"] >= CONFIDENCE_THRESHOLD: return "act"
    if state["iterations"] >= MAX_ITERATIONS:       return "escalate"
    return "observe"   # gather more evidence

def route_after_act(state: OSPFAgentState) -> str:
    return "verify" if (state["approved"] and state["applied"]) else END


def build_graph():
    graph = StateGraph(OSPFAgentState)
    graph.add_node("observe", observe)
    graph.add_node("reason",  reason)
    graph.add_node("act",     act)
    graph.add_node("verify",  verify)
    graph.set_entry_point("observe")
    graph.add_edge("observe", "reason")
    graph.add_edge("verify",  END)
    graph.add_conditional_edges("reason", route_after_reason,
                                 {"act": "act", "observe": "observe", "escalate": END})
    graph.add_conditional_edges("act", route_after_act,
                                 {"verify": "verify", END: END})
    return graph.compile(checkpointer=MemorySaver())
```

---

### Expected Terminal Output

```
[OBSERVE] KB hits: 1 — prior INIT state, different neighbor, 6 weeks ago
[OBSERVE] Running: show ip ospf neighbor detail
[OBSERVE] Running: show ip ospf interface GigabitEthernet0/1

[REASON] Diagnosis: OSPF area mismatch — local Gi0/1 is area 0, neighbor expects area 1
[REASON] Confidence: 94%

--- PROPOSED FIX ---
Device:     client-rtr-01
Diagnosis:  OSPF area mismatch on GigabitEthernet0/1
Confidence: 94%

Config change:
interface GigabitEthernet0/1
  ip ospf 1 area 1
--------------------

Approve this change? (yes/no): yes

Change applied to client-rtr-01.
Waiting 30 seconds for OSPF convergence...

Resolved. Neighbor 3.3.3.3 is now FULL/DR.

--- RUN SUMMARY ---
Iterations:  1
Confidence:  94%
Outcome:     Resolved
Wall time:   ~95 seconds
-------------------
```

One observe/reason cycle. Confidence threshold hit first pass. Under two minutes.


---

Module 8 · Lesson 3 — Where to Go Next

Read time: ~5 min | Module 8 of 8 — Capstone

---

### What You Just Built

You did not build a chatbot. You built a reasoning agent with:

- Memory — searches past incidents before touching a device
- Tools — runs real network commands through an authenticated session
- Context — holds topology, change history, and KB results in working state
- Safety — stops before every change and waits for a human
- Observability — every step logged, every state transition checkpointed
- Verifiability — checks its own work after applying a fix

The only thing between this and production is the quality of your knowledge base and the depth of your tool implementations.

---

### Extension Path 1: More Protocols

The agent pattern is protocol-agnostic. Same architecture, different show commands.

```python
# tools/bgp_tools.py
def get_bgp_summary(device: str) -> dict: ...
def get_bgp_neighbor_detail(device: str, peer_ip: str) -> dict: ...
def get_bgp_route_table(device: str, prefix: str) -> dict: ...
```

Add a BGPAgentState TypedDict. Write BGP-specific OBSERVE and REASON prompts. The graph structure is identical. The checkpointer is identical. The MCP session layer is identical. You are not starting over — you are adding a module.

---

### Extension Path 2: Multi-Client

One agent codebase. Multiple clients. Data isolation per client.

```python
# Per-client ChromaDB collection
client  = chromadb.PersistentClient(path=f"./db/{client_id}")
kb      = client.get_or_create_collection(f"incidents_{client_id}")

# Per-client MCP profile
context = get_mcp_context_for_prompt(client_id)
```

Pass client_id into run(). The agent uses the correct KB collection and MCP profile automatically. One codebase, thirty clients.

---

### Extension Path 3: Alert-Driven Pipeline

```python
def on_alert_received(alert: dict):
    if alert["type"] == "ospf_neighbor_down":
        result = ospf_agent.run(
            device=alert["device"],
            neighbor_ip=alert["neighbor_ip"],
            neighbor_state=alert["ospf_state"],
            duration_minutes=alert["duration_minutes"],
        )
        post_diagnosis_to_ticket(
            ticket_id=alert["ticket_id"],
            diagnosis=result["diagnosis"],
            proposed_fix=result["proposed_fix"],
            confidence=result["confidence"],
        )
        # Agent stops here. Human approves in the ticket.
```

The agent investigates automatically. Posts findings to the ticket. Waits. An engineer reviews in ConnectWise or ServiceNow — the same place they work. No new tool to learn.

---

### The Roadmap: Stages of Autonomy

  Stage 1 — Read-only assist    |  Runs show commands, posts diagnosis         |  Engineer makes all changes
  Stage 2 — Propose and wait    |  Diagnoses + proposes fix, waits for approval |  Engineer reviews and approves
  Stage 3 — Tier-1 autonomous   |  Handles known issue types end-to-end        |  Engineer reviews summary after
  Stage 4 — Predictive          |  Detects anomalies before impact             |  Engineer reviews weekly reports

You built Stage 2 in this course. Stage 3 requires one thing: a knowledge base with enough resolved incidents that the agent's confidence is consistently above threshold on known issue patterns. That comes from running Stage 2 for 60-90 days on real tickets.

You do not build trust in an agent by reading about it. You build it by watching it be right, repeatedly, on real incidents.

---

### The Business Case

Average tier-1 network ticket: 25 minutes of engineer time at $65/hour loaded = $27 per ticket.

If the agent handles 30% of those tickets without engineer involvement at 100 tickets/month: 30 tickets automated, $810/month recovered, $9,720/year. From one protocol on one client segment.

The number is not the point. The point is that every ticket the agent closes correctly is an engineer freed to work on something a model cannot do: the client relationship, the architecture conversation, the strategic roadmap review.

---

### Capstone Challenge

Run the complete OSPF agent against your lab. When it completes, post in #agent-builds:

1. A screenshot of the --- RUN SUMMARY --- block
2. How many iterations to reach confidence threshold
3. The agent's confidence score

Every member who completes this challenge has built a production-grade AI agent from scratch. Not a tutorial project. An agent with memory, tools, safety checkpoints, and a graph-based reasoning loop — the same architecture running in production AI systems today.

That puts you ahead of 99% of MSPs in the market right now.

---

Build Your First AI Agent from Scratch — Modules 1-8 complete.
Community: skool.com/autonomous-msp-2162
