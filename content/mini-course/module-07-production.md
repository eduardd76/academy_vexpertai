# Module 7: Production, Safety and Observability
### Make Your Agent Trustworthy Before You Let It Near Real Devices

**Duration:** 1 hour
**What you build:** LangSmith tracing, Prometheus metrics, RBAC model, and a deployment checklist.

---

## 7.1 Trust Is the Only Thing That Matters

You wouldn't deploy a new routing protocol to production without testing it in a lab, monitoring it carefully, and having a rollback plan. The same discipline applies to your AI agent.

An agent that operators don't trust will not be used. An agent that operators can observe, audit, and control will be adopted and become valuable over time.

This module covers four pillars of production readiness:
1. **Human-in-the-Loop** — the agent cannot touch production without permission
2. **Observability** — you can see every decision the agent made
3. **Security** — secrets, RBAC, and audit logs
4. **Reliability** — it doesn't fail silently, it doesn't loop forever

---

## 7.2 Human-in-the-Loop (Already Partially Built)

In Module 3, you built the safety gate in `execute_with_approval()`. Here we make it more complete.

The principle: **READ is automatic. WRITE always pauses.**

For production, the approval should be more than a terminal prompt. It should:
- Show a clear summary of what will change
- Show a config diff
- Explain the risk level
- Log the decision (who approved, when, why)

Update `my-network-agent/tools/safety.py`:

```python
import logging
import datetime
import json
from tools.base import BaseTool, ToolCategory, ToolResult

# Audit logger — writes every approval/rejection to file
audit_logger = logging.getLogger("agent.audit")
audit_logger.setLevel(logging.INFO)
handler = logging.FileHandler("agent_audit.log")
handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
audit_logger.addHandler(handler)


def log_tool_execution(tool_name: str, params: dict, approved: bool, operator: str = ""):
    """Write every tool decision to the audit log."""
    audit_logger.info(json.dumps({
        "tool": tool_name,
        "params": params,
        "approved": approved,
        "operator": operator or "auto",
        "timestamp": datetime.datetime.utcnow().isoformat(),
    }))


def execute_with_approval(tool: BaseTool, params: dict, auto_approve_reads: bool = True) -> ToolResult:
    import time

    if tool.category == ToolCategory.READ and auto_approve_reads:
        start = time.time()
        result = tool.execute(**params)
        result.execution_time_ms = (time.time() - start) * 1000
        result.tool_name = tool.name
        log_tool_execution(tool.name, params, approved=True)
        return result

    if tool.category == ToolCategory.WRITE:
        print("\n" + "=" * 60)
        print("  APPROVAL REQUIRED")
        print("=" * 60)
        print(f"  Tool    : {tool.name}")
        print(f"  Action  : {tool.description}")
        print(f"  Params  : {json.dumps(params, indent=4)}")

        # Show config diff if available
        if hasattr(tool, 'preview_change'):
            preview = tool.preview_change(**params)
            if preview:
                print(f"\n  DIFF:\n{preview}")

        print("=" * 60)
        operator = input("  Your name: ").strip()
        decision = input("  Approve? (y/n): ").strip().lower()

        log_tool_execution(tool.name, params, approved=(decision == "y"), operator=operator)

        if decision != "y":
            return ToolResult(success=False, data=None, error=f"Rejected by {operator}",
                              tool_name=tool.name)

    if tool.category == ToolCategory.ADMIN:
        print("\n" + "!" * 60)
        print("  ADMIN OPERATION — HIGH RISK")
        print(f"  Tool: {tool.name}")
        print(f"  Params: {params}")
        confirm = input("  Type 'YES I CONFIRM' to proceed: ").strip()
        approved = confirm == "YES I CONFIRM"
        log_tool_execution(tool.name, params, approved=approved, operator="manual-confirm")
        if not approved:
            return ToolResult(success=False, data=None, error="Admin confirmation failed",
                              tool_name=tool.name)

    start = time.time()
    try:
        result = tool.execute(**params)
        result.execution_time_ms = (time.time() - start) * 1000
        result.tool_name = tool.name
        return result
    except Exception as e:
        return ToolResult(success=False, data=None, error=str(e), tool_name=tool.name,
                          execution_time_ms=(time.time() - start) * 1000)
```

---

## 7.3 Observability With LangSmith

LangSmith gives you a complete trace of every agent run — which nodes ran, how long they took, what the LLM was thinking, what tools fired.

```python
# At the TOP of agent.py — before anything else
import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_PROJECT"] = "network-ops-agent"
os.environ["LANGCHAIN_API_KEY"] = os.environ.get("LANGSMITH_API_KEY", "")
```

That's all. After this, every `agent.invoke()` call sends a complete trace to `smith.langchain.com`.

You'll see:
```
Run: "OSPF neighbor INIT state on rtr-01"
├─ observe (2.1s)
│   └─ LLM call: [prompt] -> [response]
│   └─ ChromaDB query: "OSPF INIT" -> 2 results
├─ reason (3.2s)
│   └─ LLM call: [prompt] -> TOOL_CALL: run_show_command
├─ act (1.8s)
│   └─ Tool: run_show_command(rtr-01, "show ip ospf neighbor")
│   └─ Result: {"neighbors": [...]}
├─ reason (2.9s)
│   └─ LLM call: [prompt] -> TOOL_CALL: check_ospf_config
├─ act (1.2s)
│   └─ Tool: check_ospf_config(rtr-01, Gi0/1)
│   └─ Result: area=1 (mismatch!)
├─ reason (2.1s)
│   └─ LLM call: [prompt] -> CONCLUDE (confidence=0.92)
└─ verify (3.8s)
    └─ LLM call: [prompt] -> FINAL_ANSWER
```

---

## 7.4 Prometheus Metrics

LangSmith gives you the reasoning trace. Prometheus gives you operational metrics for your dashboards.

Create `my-network-agent/observability.py`:

```python
from prometheus_client import Counter, Histogram, Gauge, start_http_server
import time

# Metric definitions
QUERIES_TOTAL = Counter(
    "agent_queries_total",
    "Total queries processed",
    ["status"],  # label: success / failed
)
QUERY_LATENCY = Histogram(
    "agent_query_latency_seconds",
    "Time from query to final answer",
    buckets=[5, 10, 30, 60, 120, 300],
)
TOOL_CALLS = Counter(
    "agent_tool_calls_total",
    "Tool invocations by name and outcome",
    ["tool_name", "outcome"],  # labels: tool_name, outcome (success/failed/rejected)
)
CONFIDENCE_GAUGE = Gauge(
    "agent_last_confidence",
    "Confidence score of the last completed query",
)
ITERATIONS_HISTOGRAM = Histogram(
    "agent_iterations_per_query",
    "Number of OBSERVE-REASON-ACT cycles per query",
    buckets=[1, 2, 3, 5, 8, 13],
)


def record_query_result(state: dict, start_time: float):
    """Call this after agent.invoke() to record metrics."""
    duration = time.time() - start_time
    status = "success" if state.get("done") else "failed"

    QUERIES_TOTAL.labels(status=status).inc()
    QUERY_LATENCY.observe(duration)
    CONFIDENCE_GAUGE.set(state.get("confidence", 0))
    ITERATIONS_HISTOGRAM.observe(state.get("iteration", 0))

    for tc in state.get("tool_calls", []):
        outcome = "success" if tc["success"] else "failed"
        TOOL_CALLS.labels(tool_name=tc["tool_name"], outcome=outcome).inc()


def start_metrics_server(port: int = 9090):
    """Start Prometheus metrics endpoint at /metrics."""
    start_http_server(port)
    print(f"Metrics available at http://localhost:{port}/metrics")
```

Add to `agent.py`:

```python
from observability import record_query_result, start_metrics_server
import time

def run(query: str, max_iterations: int = 8) -> dict:
    start = time.time()
    agent = build_agent()
    initial_state = ...  # as before

    try:
        final_state = agent.invoke(initial_state)
        record_query_result(final_state, start)
        return final_state
    except Exception as e:
        QUERIES_TOTAL.labels(status="error").inc()
        raise
```

---

## 7.5 Security: Never Hardcode Credentials

Use environment variables. In production use Vault or AWS Secrets Manager.

```python
# my-network-agent/.env  (add to .gitignore — NEVER commit this)
ANTHROPIC_API_KEY=sk-ant-...
LANGSMITH_API_KEY=ls__...
NETBOX_TOKEN=abc123...
NETBOX_URL=https://netbox.yourcompany.com
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=strongpassword
DEVICE_SSH_USER=netops-agent
DEVICE_SSH_KEY=/home/netops/.ssh/id_rsa_agent
```

```python
# my-network-agent/config.py
import os
from dotenv import load_dotenv

load_dotenv()  # Loads .env file if present

class Config:
    ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]   # Hard fail if missing
    NETBOX_URL = os.environ.get("NETBOX_URL", "")
    NETBOX_TOKEN = os.environ.get("NETBOX_TOKEN", "")
    NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
    NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")
    DEVICE_SSH_USER = os.environ.get("DEVICE_SSH_USER", "readonly")
    DEVICE_SSH_KEY = os.environ.get("DEVICE_SSH_KEY", "")
    MAX_ITERATIONS = int(os.environ.get("AGENT_MAX_ITERATIONS", "10"))
```

---

## 7.6 RBAC: Two Credential Sets

The agent should have two different SSH credential sets:

```python
# READ operations use a read-only account (no config permission)
READ_CREDENTIALS = {
    "username": os.environ["DEVICE_SSH_USER_READONLY"],
    "password": os.environ["DEVICE_SSH_PASS_READONLY"],
}

# WRITE operations use a separate account that requires human approval first
WRITE_CREDENTIALS = {
    "username": os.environ["DEVICE_SSH_USER_WRITE"],
    "password": os.environ["DEVICE_SSH_PASS_WRITE"],
}
```

On the device:
```
! Cisco IOS — read-only user
username netops-agent-ro privilege 1 secret [strong-password]

! Cisco IOS — config user (only used after human approval)
username netops-agent-rw privilege 15 secret [different-strong-password]
```

---

## 7.7 Guard Against Infinite Loops

Add these safeguards to the agent:

```python
# In state.py — add to AgentState
total_tokens_used: int = 0
start_time: float = 0.0
max_wall_time_seconds: int = 300  # 5 minute max per query

# In route_after_reason — add time check
def route_after_reason(state: AgentState) -> str:
    import time
    elapsed = time.time() - state["start_time"]

    if state["iteration"] >= state["max_iterations"]:
        print(f"Max iterations ({state['max_iterations']}) reached, forcing verify.")
        return "verify"

    if elapsed > state["max_wall_time_seconds"]:
        print(f"Wall time limit ({state['max_wall_time_seconds']}s) reached, forcing verify.")
        return "verify"

    if state["phase"] == AgentPhase.VERIFY:
        return "verify"

    return "act"
```

---

## 7.8 Production Readiness Checklist

Before pointing your agent at a real network, confirm:

**Safety**
- [ ] All WRITE tools require human approval (tested by pressing 'n' and confirming nothing happened)
- [ ] Agent uses read-only SSH credentials for show commands
- [ ] Separate write credentials only loaded after approval
- [ ] Config diff shown before every config push
- [ ] Audit log enabled and writing to file
- [ ] Max iterations set (default 10)
- [ ] Wall time limit set (default 300 seconds)

**Security**
- [ ] No credentials in code — all from environment variables
- [ ] `.env` file in `.gitignore`
- [ ] LangSmith API key not logged or printed
- [ ] Audit log stored on secure system, not just a local file

**Observability**
- [ ] LangSmith tracing enabled
- [ ] Prometheus metrics endpoint running
- [ ] At least one Grafana dashboard for confidence + latency
- [ ] Alert if confidence is consistently below 0.5 (agent is guessing)

**Reliability**
- [ ] Agent tested with demo mode before real devices
- [ ] Tested on lab devices before production
- [ ] Fallback: if agent fails, operations continue manually as before
- [ ] Rollback plan documented if a config change goes wrong

**Governance**
- [ ] Operators trained on approving/rejecting agent proposals
- [ ] Clear escalation path if agent suggests something unexpected
- [ ] Regular review of audit logs (weekly minimum)

---

## Lab 7.1: Read the Audit Log

Run a few agent queries and then inspect the audit log:

```bash
python agent.py  # run a query
cat agent_audit.log
```

The audit log should contain JSON entries for every tool call. Can you tell from the log:
- What query was run?
- Which tools were called?
- Were any WRITE tools approved or rejected?
- How long did each tool take?

If any of these questions can't be answered, your audit log is incomplete.

---

## Module 7 Quiz

1. What is the minimum that must happen before a WRITE tool is allowed to execute?
2. Why should READ tools use a different SSH account than WRITE tools?
3. If LangSmith tracing is enabled and the API key is invalid, what happens to the agent? (Hint: test it)
4. What does a consistently low confidence score (below 0.4) tell you about your agent?
5. A colleague says: "We don't need observability for a troubleshooting agent — it just answers questions." How would you respond?

---

## What's Next

You have all the pieces. In the final module, you wire everything together into one complete, runnable OSPF troubleshooting agent — the capstone project.

**Module 8: Capstone — The Complete OSPF Troubleshooting Agent ->**


---

Module 7 · Lesson 1 — The Audit Log and Human-in-the-Loop

Read time: ~6 min | Module 7 of 8

---

### The Rule. No Exceptions.

READ is automatic. WRITE always pauses.

The agent can run show running-config, show ip route, show interfaces without asking. It cannot push a config change, create a firewall rule, or restart a service without a human approving it first.

This is not a soft guideline. This is your liability protection. When a client's VLAN is misconfigured at 2 AM and they ask "who changed this and did anyone approve it?" — your audit log answers that question, or you have no answer at all.

---

### Why MSP Clients Specifically Need This

You are running this agent on infrastructure that belongs to someone else, infrastructure with SLAs attached to it, infrastructure that feeds into compliance audits. HIPAA, PCI, SOC 2 — they all require change management records.

An agent that acts autonomously on WRITE operations is an agent your clients' compliance teams will reject. An agent with a human-in-the-loop approval gate and a timestamped, signed audit log is an agent you can sell.

---

### The Approval Gate

Every WRITE tool call goes through this function. No exceptions.

```python
import json, difflib
from datetime import datetime, timezone

AUDIT_LOG_PATH = "agent_audit.log"

WRITE_TOOLS = {"push_config", "apply_acl", "restart_service", "create_vlan", "delete_route"}


def execute_with_approval(tool_name: str, params: dict, tool_fn, operator: str = None):
    is_write = tool_name in WRITE_TOOLS

    if not is_write:
        result = tool_fn(**params)
        _log_action(tool_name, params, approved=True, operator="auto", result="executed")
        return result

    # WRITE path — show diff, require approval
    print(f"\n[APPROVAL REQUIRED] Tool: {tool_name}")
    print(f"Parameters: {json.dumps(params, indent=2)}")

    if "config_block" in params:
        _show_diff(params.get("current_config", ""), params["config_block"])

    if not operator:
        operator = input("Enter your name to approve (or 'deny'): ").strip()

    if operator.lower() == "deny":
        _log_action(tool_name, params, approved=False, operator="denied", result="rejected")
        return {"status": "denied", "message": "Operator denied this action."}

    result = tool_fn(**params)
    _log_action(tool_name, params, approved=True, operator=operator, result="executed")
    return result


def _show_diff(current: str, proposed: str):
    diff = list(difflib.unified_diff(
        current.splitlines(), proposed.splitlines(),
        fromfile="current", tofile="proposed", lineterm=""
    ))
    if diff:
        print("\n--- Config Diff ---")
        for line in diff:
            print(line)
        print("-------------------\n")


def _log_action(tool_name, params, approved, operator, result):
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "tool": tool_name, "params": params,
        "approved": approved, "operator": operator, "result": result,
    }
    with open(AUDIT_LOG_PATH, "a") as f:
        f.write(json.dumps(entry) + "\n")
```

---

### Audit Log Format

One JSON object per line — not a JSON array. One per line means you can grep it without parsing the entire file.

```json
{"timestamp": "2026-03-21T14:02:11+00:00", "tool": "run_show_command", "params": {"device": "core-sw-01"}, "approved": true, "operator": "auto", "result": "executed"}
{"timestamp": "2026-03-21T14:03:44+00:00", "tool": "push_config", "params": {"device": "core-sw-01", "config": "ip ospf 1 area 0"}, "approved": true, "operator": "Eduard Dulharu", "result": "executed"}
{"timestamp": "2026-03-21T14:04:01+00:00", "tool": "push_config", "params": {"device": "core-sw-01", "config": "shutdown"}, "approved": false, "operator": "denied", "result": "rejected"}
```

```bash
cat agent_audit.log | grep push_config
```

This is not just debugging. This is proof. Your client's ISO auditor, their cyber insurance underwriter, their internal IT director — they can ask "did a human approve every change?" and you hand them this file. That is a competitive advantage over MSPs running scripts with no accountability trail.

---

### Two SSH Accounts — Non-Negotiable

Read-only account is the default. The agent uses it for all show commands.

```ios
! Privilege 1 = show commands only. Cannot enter config mode.
username agent-read privilege 1 password <strong-password>
```

Write account loads only after a human approves a WRITE operation. Never touches disk in plain text.

```python
# config.py — credentials from environment, never hardcoded
import os
from dotenv import load_dotenv

load_dotenv()

SSH_READ  = {"username": os.getenv("SSH_READ_USER"),  "password": os.getenv("SSH_READ_PASS")}
SSH_WRITE = {"username": os.getenv("SSH_WRITE_USER"), "password": os.getenv("SSH_WRITE_PASS")}
```

.env must be in .gitignore before your first commit. If it lands in git history, rotating the credentials is not enough — the history still contains them.


---

Module 7 · Lesson 2 — Observability: LangSmith and Prometheus

Read time: ~7 min | Module 7 of 8

---

### Why Observability Is Not Optional

Here is what happens when you deploy an agent without observability: it runs, it does things, sometimes it gets the right answer, sometimes it does not. Your operators cannot see what it was thinking. They cannot tell if a wrong answer was a reasoning failure or a tool failure. They cannot tell if it is getting slower over time.

Operators who cannot see inside an agent will not trust it. Operators who do not trust it will stop using it.

---

### LangSmith — Three Lines to Full Tracing

Add these to your .env:

```
LANGCHAIN_TRACING_V2=true
LANGCHAIN_ENDPOINT=https://api.smith.langchain.com
LANGCHAIN_API_KEY=your-langsmith-api-key
```

That is it. No code changes to your agent. Every call — every LLM step, every tool invocation — is automatically traced with timing data, inputs, outputs, and token counts.

A trace for one agent run:

```
[AgentRun: "check OSPF neighbors on R1"]  total: 4.2s
  |
  +-- [observe] get_ospf_neighbors    ->  1.1s  — 3 neighbors, 1 in EXSTART
  +-- [reason]  LLM call (gpt-4o)    ->  1.8s  — 412 prompt / 87 completion tokens
  |             "Neighbor stuck in EXSTART — likely MTU mismatch"
  +-- [act]     show_interface_mtu   ->  0.9s  — MTU 1500
  +-- [verify]  show_interface_mtu   ->  0.4s  — MTU 1476
                "MTU mismatch confirmed. Set ip mtu 1476 on R1 Gi0/0."
```

When the agent gives a wrong answer, you click into the trace and see exactly which reasoning step failed. Free up to 5,000 traces/month.

---

### Prometheus — Metrics That Matter

```bash
pip install prometheus-client
```

```python
# agent/metrics.py
from prometheus_client import Counter, Histogram, Gauge, start_http_server

def start_metrics_server(port: int = 8000):
    start_http_server(port)

agent_requests = Counter(
    "agent_requests_total", "Total agent requests", ["outcome"]
)
agent_latency = Histogram(
    "agent_response_seconds", "Agent end-to-end response time",
    buckets=[1, 2, 5, 10, 30, 60, 120, 300]
)
agent_confidence = Gauge(
    "agent_confidence_score", "Confidence score from last agent reasoning step"
)
tool_calls = Counter(
    "agent_tool_calls_total", "Tool calls by the agent", ["tool_name", "outcome"]
)
```

Wrap your agent execution to record metrics:

```python
import time
from agent.metrics import agent_requests, agent_latency, agent_confidence

def run_agent_with_metrics(query: str, agent) -> dict:
    start = time.time()
    try:
        result   = agent.run(query)
        duration = time.time() - start

        agent_requests.labels(outcome="success").inc()
        agent_latency.observe(duration)
        if "confidence" in result:
            agent_confidence.set(result["confidence"])
        return result
    except Exception:
        agent_requests.labels(outcome="failed").inc()
        raise
```

---

### The Four Metrics Worth Watching

Confidence distribution. Consistently above 0.8 = operators trust the agent. Consistently below 0.5 = your knowledge base does not have enough context about that client. Fix the knowledge base, not the agent.

Tool call patterns. Which tools get called most? If show_running_config is called five times per run, the agent is pulling full configs repeatedly. Performance problem you would never see without metrics.

Tool denial rate by tool name. If any WRITE tool has a denial rate above 30%, operators do not trust what the agent is proposing. That is a trust problem. Talk to the operators, understand what makes them uncomfortable, update the reasoning prompts.

Local vs. cloud model routing ratio. If 90% of queries are going to the cloud model when you expected 50%, your routing logic is not working.

---

### Four Grafana Panels, 30-Second Refresh

  Panel              | Metric                      | Type
  Request rate       | agent_requests_total        | Stat
  P95 latency        | agent_response_seconds      | Time series
  Confidence score   | agent_confidence_score      | Gauge
  Tool calls by name | agent_tool_calls_total      | Bar chart

Set the confidence gauge: green above 0.8, yellow 0.5-0.8, red below 0.5. When an operator opens Grafana and sees green, they trust the agent.


---

Module 7 · Lesson 3 — Production Readiness Checklist

Read time: ~5 min | Module 7 of 8

---

### Before You Touch a Client Network

Go through this checklist before deploying to any production MSP environment. Not most of it. All of it.

---

### Safety

[ ] WRITE tools require explicit operator approval — tested with a deliberate WRITE call in staging
[ ] Read-only SSH credentials configured as the default on all managed devices
[ ] Write SSH credentials stored separately, loaded only after approval
[ ] Config diff displayed to the operator before any WRITE execution
[ ] Audit log writing to agent_audit.log — verify with a test run
[ ] max_iterations set on the agent (recommended: 10)
[ ] Wall time limit set (recommended: 300 seconds)

---

### Security

[ ] No credentials in any source file — verify with: grep -r "password" . and grep -r "secret" .
[ ] .env listed in .gitignore before the first commit
[ ] .env absent from git log history
[ ] Agent process runs as a non-root service account

---

### Observability

[ ] LangSmith tracing enabled — open LangSmith UI and verify a trace appears after a test run
[ ] Prometheus endpoint reachable at :8000/metrics
[ ] At least one Grafana panel displaying live data
[ ] Confidence score metric recorded per run
[ ] Tool call counter recording by tool name and outcome

---

### Reliability — Add Retry Logic

```python
import time
from functools import wraps

def with_retry(max_retries: int = 3, base_delay: float = 2.0):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    return fn(*args, **kwargs)
                except Exception as e:
                    if attempt == max_retries - 1:
                        raise
                    delay = base_delay * (2 ** attempt)
                    print(f"[retry] {fn.__name__} attempt {attempt+1} failed. Retrying in {delay}s.")
                    time.sleep(delay)
        return wrapper
    return decorator


@with_retry(max_retries=3, base_delay=2.0)
def show_running_config(host: str) -> str:
    # your SSH logic here
    pass
```

First failure waits 2 seconds. Second waits 4. Third waits 8. After three failures it raises to the agent, which logs it as a tool failure in Prometheus.

---

### MSP-Specific Requirements

These are not in generic AI agent guides.

[ ] Each client has their own MCP context profile — device inventory, topology, approved change windows
[ ] New client networks run in read-only mode for the first 30 days. No WRITE tools, regardless of what the agent proposes. Use this time to build the context profile.
[ ] Change requests generated by the agent go through your existing ticketing system before execution. Ticket number logged in agent_audit.log alongside the approval.
[ ] Operators know how to read the audit log. Run one 10-minute session: cat agent_audit.log | grep push_config. That is it.
[ ] You have tested what happens when the agent is denied: it accepts rejection and stops. It does not loop and ask again.

---

Module Challenge: Run your agent against a test query that exercises at least one READ tool and attempts at least one WRITE tool. Open agent_audit.log. Post in #agent-builds:

  Tool calls logged: [number]
  WRITE attempted: yes/no
  If yes — approved or denied, and by whom

This is your first audit review.


---

Module 7 · Lesson 4 — Agent Evaluation

Read time: ~7 min | Module 7 of 8 — Production Safety

---

### The Question Nobody Asks Until It Is Too Late

You have deployed your agent. It is running on real incidents. Operators are reviewing its proposed fixes and approving or rejecting them. You have the audit log. You have Prometheus metrics. You have LangSmith traces.

Is the agent getting better over time?

Most MSPs running their first agent cannot answer that question. They know the agent ran. They do not know if it ran well. This lesson gives you the measurement framework to answer it — and to know when the agent has earned Stage 3 autonomy.

---

### The Two KPIs That Actually Matter for MSP Agents

Ignore generic AI evaluation metrics. Accuracy@5, BLEU scores, benchmark leaderboards — these measure research models on academic tasks. You have a different job.

**KPI 1: MTTD — Mean Time To Diagnosis**

Time from incident open to agent producing a root cause with confidence >= threshold.

For a human engineer, MTTD on a tier-1 OSPF issue is typically 15-25 minutes. Your agent should be under 3 minutes including tool execution time.

```python
# Add to your audit log writer (_log_action in module-07-lesson-1.md)
def _log_diagnosis(state: dict, start_time: float):
    entry = {
        "timestamp":   datetime.utcnow().isoformat(),
        "event":       "diagnosis_complete",
        "ticket_id":   state.get("ticket_id"),
        "client_id":   state.get("client_id"),
        "device":      state["device"],
        "iterations":  state["iterations"],
        "confidence":  state["confidence"],
        "diagnosis":   state["diagnosis"],
        "mttd_seconds": time.time() - start_time,
    }
    with open("agent_audit.log", "a") as f:
        f.write(json.dumps(entry) + "\n")
```

**KPI 2: MTTR — Mean Time To Resolution**

Time from incident open to verified resolution. This includes MTTD plus human approval time plus apply + verify. For Stage 2 (human in the loop), MTTR is MTTD + however long it takes an engineer to review and approve.

Your agent controls MTTD directly. It influences MTTR by the quality of its proposed fix — a clearly explained, high-confidence fix gets approved faster.

Track both. Report both. These are the numbers your clients care about.

---

### Confidence Calibration: Is 80% Actually 80%?

Your agent outputs a confidence score. That score is meaningless unless it is calibrated — unless 80% confidence actually means the diagnosis is correct 80% of the time.

Run this analysis monthly:

```python
import json
from collections import defaultdict

def calibration_report(audit_log_path: str) -> dict:
    # Load all diagnosis events with their outcomes
    diagnoses = []
    outcomes  = {}

    with open(audit_log_path) as f:
        for line in f:
            entry = json.loads(line)
            if entry["event"] == "diagnosis_complete":
                diagnoses.append(entry)
            elif entry["event"] == "verify_complete":
                ticket_id = entry.get("ticket_id")
                if ticket_id:
                    outcomes[ticket_id] = entry.get("resolved", False)

    # Group by confidence bucket (0.6-0.7, 0.7-0.8, 0.8-0.9, 0.9-1.0)
    buckets = defaultdict(lambda: {"correct": 0, "total": 0})
    for d in diagnoses:
        conf    = d.get("confidence", 0)
        bucket  = f"{int(conf * 10) / 10:.1f}-{int(conf * 10) / 10 + 0.1:.1f}"
        resolved = outcomes.get(d.get("ticket_id"), None)
        if resolved is not None:
            buckets[bucket]["total"] += 1
            if resolved:
                buckets[bucket]["correct"] += 1

    report = {}
    for bucket, counts in sorted(buckets.items()):
        if counts["total"] > 0:
            accuracy = counts["correct"] / counts["total"]
            report[bucket] = {
                "n":        counts["total"],
                "accuracy": f"{accuracy:.0%}",
                "gap":      f"{(float(bucket.split('-')[0]) - accuracy):+.0%}"
            }
    return report
```

Example output after 60 days:

```
Confidence bucket | N  | Actual accuracy | Gap
0.6-0.7           | 12 | 58%             | -7%
0.7-0.8           | 28 | 71%             | -4%
0.8-0.9           | 45 | 83%             | +3%
0.9-1.0           | 31 | 94%             | +4%
```

A well-calibrated agent has a gap near zero across all buckets. This agent is slightly overconfident at 0.6-0.7 (says 65% confident but only correct 58% of the time) and well-calibrated above 0.8.

**What to do with this:**

- If the agent is consistently overconfident below 0.75: raise your CONFIDENCE_THRESHOLD from 0.8 to 0.85. It should not be proposing fixes at confidence levels where it is frequently wrong.
- If the 0.9+ bucket has low N (fewer than 20 incidents): your KB does not have enough known-good resolutions yet. Keep running Stage 2 and adding resolved incidents.
- If the gap is positive at all confidence levels (agent is underconfident): you may be able to lower CONFIDENCE_THRESHOLD safely, which reduces escalations.

---

### The 30-Day Accuracy Audit

Run this at the end of every 30-day period. It gives you a structured view of agent performance.

```python
def thirty_day_audit(audit_log_path: str) -> dict:
    from datetime import datetime, timedelta, timezone

    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    diagnoses   = []
    approvals   = {}
    resolutions = {}

    with open(audit_log_path) as f:
        for line in f:
            e = json.loads(line)
            ts = datetime.fromisoformat(e["timestamp"]).replace(tzinfo=timezone.utc)
            if ts < cutoff:
                continue

            if e["event"] == "diagnosis_complete":
                diagnoses.append(e)
            elif e["event"] == "approval":
                approvals[e.get("ticket_id")] = e.get("approved", False)
            elif e["event"] == "verify_complete":
                resolutions[e.get("ticket_id")] = e.get("resolved", False)

    total          = len(diagnoses)
    approved       = sum(1 for v in approvals.values() if v)
    resolved       = sum(1 for v in resolutions.values() if v)
    avg_mttd       = sum(d.get("mttd_seconds", 0) for d in diagnoses) / max(total, 1)
    avg_confidence = sum(d.get("confidence", 0) for d in diagnoses) / max(total, 1)
    avg_iterations = sum(d.get("iterations", 0) for d in diagnoses) / max(total, 1)

    return {
        "period":              "last 30 days",
        "total_incidents":     total,
        "diagnoses_produced":  total,
        "human_approval_rate": f"{approved/max(total,1):.0%}",
        "resolution_rate":     f"{resolved/max(approved,1):.0%}",
        "avg_mttd_seconds":    f"{avg_mttd:.0f}",
        "avg_confidence":      f"{avg_confidence:.2f}",
        "avg_iterations":      f"{avg_iterations:.1f}",
    }
```

Example output after month 2:

```
Period:               Last 30 days
Total incidents:      47
Diagnoses produced:   47
Human approval rate:  89%     <-- operators approved 89% of proposed fixes
Resolution rate:      91%     <-- of approved fixes, 91% resolved the issue
Avg MTTD:             94s
Avg confidence:       0.86
Avg iterations:       1.4
```

This is a Stage 2 agent performing well. 89% approval rate means operators trust the diagnoses. 91% resolution rate means the fixes work. 94 seconds MTTD is well under the 3-minute target.

---

### Stage 3 Readiness Criteria

From Module 8 Lesson 3: Stage 3 means the agent handles known issue types end-to-end without pre-approval. The engineer reviews a summary after.

Do not move to Stage 3 based on a feeling. Use these criteria:

```
[ ] 90+ days of Stage 2 operation on this client
[ ] 100+ incidents processed by the agent
[ ] Resolution rate >= 88% over the last 30 days
[ ] Human approval rate >= 85% over the last 30 days
    (operators approve most fixes without significant hesitation)
[ ] No P1 incidents caused by an agent-applied fix
[ ] Calibration report shows gap < 10% in the 0.8-0.9 bucket
[ ] avg_iterations <= 2.0
    (agent rarely needs more than 2 observe/reason cycles)
[ ] Operators have explicitly said they trust the agent's reasoning
    for this class of issue
```

Stage 3 should be scoped, not blanket. The agent might earn Stage 3 autonomy for OSPF area mismatches (highly predictable, well-understood fix pattern) while remaining at Stage 2 for BGP policy changes (higher blast radius, less predictable).

Start narrow. The agent earns wider autonomy as the data accumulates.

---

### Adding the Audit Query to Your Dashboard

Add this Prometheus metric specifically for evaluation:

```python
from prometheus_client import Gauge

agent_resolution_rate = Gauge(
    "agent_resolution_rate_30d",
    "Fraction of approved fixes that resolved the incident (30-day rolling)"
)

agent_approval_rate = Gauge(
    "agent_approval_rate_30d",
    "Fraction of proposed fixes approved by operators (30-day rolling)"
)

# Run this daily, store result in Prometheus
def update_evaluation_metrics():
    audit = thirty_day_audit("agent_audit.log")
    agent_resolution_rate.set(
        float(audit["resolution_rate"].strip("%")) / 100
    )
    agent_approval_rate.set(
        float(audit["human_approval_rate"].strip("%")) / 100
    )
```

Add two Grafana panels:
- Approval rate: green above 80%, yellow 60-80%, red below 60%
- Resolution rate: green above 85%, yellow 70-85%, red below 70%

When both panels are consistently green for 30+ days, you have a calibrated, trustworthy agent. That is when you have the conversation with the client about expanding autonomy.

---

### The Conversation With Your Client

Stage 3 is a business conversation, not just a technical one.

When the data supports it:

> "We've been running the diagnostic agent on your OSPF incidents for 90 days. It proposed fixes on 47 incidents. Your team approved 42 of them. 38 resolved the issue — 91% resolution rate. Average time from ticket to diagnosis was 94 seconds. We'd like to discuss enabling autonomous resolution for OSPF adjacency issues, where the agent applies the fix and pages your team with a summary rather than waiting for approval. Here's the data."

That is a credible proposal. The client sees 90 days of evidence, not a sales pitch about AI. The engineer who has been approving these fixes every week is now the primary advocate — they have seen the reasoning 42 times and they trust it.

You do not sell autonomous agents. You earn them, one approved ticket at a time.

---

Module Challenge: Write a query against your audit log that computes your current approval rate and resolution rate. You do not need 47 incidents — even a test run of 5-10 incidents tells you if the logging is working correctly. Post in #agent-builds: your current resolution rate and what you think the biggest accuracy gap is in your agent right now.

Community: skool.com/autonomous-msp-2162
