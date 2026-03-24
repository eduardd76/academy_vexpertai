# Module 2: Your First Agent in Pure Python
### Build the ReAct Loop Without Any Framework

**Duration:** 1 hour
**What you build:** A minimal AI agent that can reason + call tools, in ~80 lines of Python.

---

## Why Build Without a Framework First

Frameworks like LangGraph are excellent — but they hide complexity. If you don't understand what they're doing, you can't debug them when something goes wrong.

In this module you build the core agent loop yourself:
- A list of tools (Python functions)
- A prompt that describes those tools to the LLM
- A loop: Thought -> Action -> Observation -> repeat
- A stopping condition

This is 95% of what every agent framework does. Once you see it naked, LangGraph will feel obvious.

---

## 2.1 The ReAct Prompt Pattern

The LLM needs instructions about HOW to reason. This system prompt is the key:

```python
SYSTEM_PROMPT = """You are a network troubleshooting agent.

You have access to the following tools:
{tool_descriptions}

To use a tool, respond EXACTLY in this format:
THOUGHT: [your reasoning about what to do next]
ACTION: tool_name
PARAMS: {{"param1": "value1", "param2": "value2"}}

When you have enough information to answer, respond:
THOUGHT: [your final reasoning]
FINAL_ANSWER: [your complete answer]

Think step by step. Always start with READ-only operations before proposing changes.
"""
```

The LLM sees this format, understands it, and will output structured text you can parse.

---

## 2.2 Build the Minimal Agent

Create `my-network-agent/simple_agent.py`:

```python
import json
import re
import os
from anthropic import Anthropic  # pip install anthropic

# ─────────────────────────────────────────────────────────────
# STEP 1: Define Tools as Plain Python Functions
# ─────────────────────────────────────────────────────────────

def ping_device(host: str) -> dict:
    """Simulate a ping to a network device."""
    # In real code: subprocess.run(["ping", "-c", "1", host])
    # For demo, we simulate:
    demo_results = {
        "192.168.1.1": {"reachable": True, "latency_ms": 2},
        "192.168.1.100": {"reachable": False, "latency_ms": None},
        "10.0.0.1": {"reachable": True, "latency_ms": 45},
    }
    return demo_results.get(host, {"reachable": False, "error": "Unknown host"})


def show_ospf_neighbors(device: str) -> dict:
    """Get OSPF neighbor table from a device."""
    # In real code: SSH to device, run show ip ospf neighbor
    demo_data = {
        "rtr-01": {
            "neighbors": [
                {"neighbor_id": "2.2.2.2", "state": "FULL", "interface": "Gi0/0"},
                {"neighbor_id": "3.3.3.3", "state": "INIT", "interface": "Gi0/1"},
            ]
        },
        "rtr-02": {
            "neighbors": [
                {"neighbor_id": "1.1.1.1", "state": "FULL", "interface": "Gi0/0"},
            ]
        },
    }
    return demo_data.get(device, {"error": f"Cannot connect to {device}"})


def show_interface(device: str, interface: str) -> dict:
    """Get interface status and counters."""
    demo_data = {
        ("rtr-01", "Gi0/1"): {
            "status": "up",
            "protocol": "up",
            "ip": "10.0.1.1/30",
            "mtu": 1500,
            "input_errors": 0,
            "output_errors": 0,
        }
    }
    key = (device, interface)
    return demo_data.get(key, {"status": "unknown", "error": "Interface not found"})


def check_ospf_config(device: str, interface: str) -> dict:
    """Check OSPF configuration on a specific interface."""
    demo_data = {
        ("rtr-01", "Gi0/1"): {
            "ospf_enabled": True,
            "process_id": 1,
            "area": "1",        # NOTE: area 1, not area 0
            "hello_interval": 10,
            "dead_interval": 40,
            "authentication": None,
        }
    }
    key = (device, interface)
    return demo_data.get(key, {"ospf_enabled": False})


# ─────────────────────────────────────────────────────────────
# STEP 2: Tool Registry — Maps names to functions + descriptions
# ─────────────────────────────────────────────────────────────

TOOLS = {
    "ping_device": {
        "function": ping_device,
        "description": "Ping a device to check reachability",
        "params": {"host": "IP address to ping (string)"},
    },
    "show_ospf_neighbors": {
        "function": show_ospf_neighbors,
        "description": "Get OSPF neighbor table from a router",
        "params": {"device": "Device hostname (string)"},
    },
    "show_interface": {
        "function": show_interface,
        "description": "Get interface status and error counters",
        "params": {
            "device": "Device hostname (string)",
            "interface": "Interface name e.g. Gi0/0 (string)",
        },
    },
    "check_ospf_config": {
        "function": check_ospf_config,
        "description": "Check OSPF configuration on an interface (area, timers, auth)",
        "params": {
            "device": "Device hostname (string)",
            "interface": "Interface name (string)",
        },
    },
}


def build_tool_descriptions() -> str:
    """Format tool list for the system prompt."""
    lines = []
    for name, meta in TOOLS.items():
        params_str = ", ".join(f"{k}: {v}" for k, v in meta["params"].items())
        lines.append(f"  - {name}({params_str}): {meta['description']}")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────
# STEP 3: Parse the LLM response
# ─────────────────────────────────────────────────────────────

def parse_response(text: str) -> dict:
    """
    Extract THOUGHT, ACTION, PARAMS, or FINAL_ANSWER from LLM output.
    Returns a dict with 'type' key: 'action' or 'final'.
    """
    text = text.strip()

    # Check for final answer
    if "FINAL_ANSWER:" in text:
        thought_match = re.search(r"THOUGHT:\s*(.+?)(?=FINAL_ANSWER:|$)", text, re.DOTALL)
        answer_match = re.search(r"FINAL_ANSWER:\s*(.+)", text, re.DOTALL)
        return {
            "type": "final",
            "thought": thought_match.group(1).strip() if thought_match else "",
            "answer": answer_match.group(1).strip() if answer_match else text,
        }

    # Check for tool action
    thought_match = re.search(r"THOUGHT:\s*(.+?)(?=ACTION:|$)", text, re.DOTALL)
    action_match = re.search(r"ACTION:\s*(\w+)", text)
    params_match = re.search(r"PARAMS:\s*(\{.+?\})", text, re.DOTALL)

    if action_match:
        params = {}
        if params_match:
            try:
                params = json.loads(params_match.group(1))
            except json.JSONDecodeError:
                params = {}
        return {
            "type": "action",
            "thought": thought_match.group(1).strip() if thought_match else "",
            "tool": action_match.group(1).strip(),
            "params": params,
        }

    # Fallback — treat entire response as final answer
    return {"type": "final", "thought": "", "answer": text}


# ─────────────────────────────────────────────────────────────
# STEP 4: The Agent Loop
# ─────────────────────────────────────────────────────────────

def run_agent(user_query: str, max_iterations: int = 10) -> str:
    """
    The core ReAct agent loop.
    1. Send query + tool descriptions to LLM
    2. Parse response: action or final answer
    3. If action: execute tool, add observation to history
    4. If final: return the answer
    5. Repeat up to max_iterations
    """
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # Build system prompt with tool descriptions
    system = f"""You are a network troubleshooting agent with deep expertise in routing protocols.

You have access to these tools:
{build_tool_descriptions()}

To use a tool, respond in EXACTLY this format:
THOUGHT: [your reasoning]
ACTION: tool_name
PARAMS: {{"param1": "value1"}}

When you have a definitive answer:
THOUGHT: [your final reasoning]
FINAL_ANSWER: [clear, actionable answer with root cause and recommendation]

Think systematically. Start with layer 1/2, then layer 3, then protocol-specific checks.
"""

    messages = [{"role": "user", "content": user_query}]

    print(f"\nAgent starting: '{user_query}'")
    print("=" * 60)

    for iteration in range(max_iterations):
        # Call the LLM
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system,
            messages=messages,
        )
        llm_output = response.content[0].text

        # Parse the response
        parsed = parse_response(llm_output)

        # Display reasoning
        if parsed.get("thought"):
            print(f"\n[Iteration {iteration + 1}] THOUGHT: {parsed['thought'][:200]}")

        # Final answer — we're done
        if parsed["type"] == "final":
            print(f"\nFINAL ANSWER:\n{parsed['answer']}")
            return parsed["answer"]

        # Execute tool
        tool_name = parsed["tool"]
        params = parsed["params"]
        print(f"ACTION: {tool_name}({params})")

        if tool_name not in TOOLS:
            observation = f"ERROR: Tool '{tool_name}' not found."
        else:
            tool_fn = TOOLS[tool_name]["function"]
            try:
                result = tool_fn(**params)
                observation = json.dumps(result, indent=2)
            except Exception as e:
                observation = f"ERROR executing {tool_name}: {str(e)}"

        print(f"OBSERVATION: {observation[:200]}")

        # Add to conversation history so LLM sees the full context
        messages.append({"role": "assistant", "content": llm_output})
        messages.append({
            "role": "user",
            "content": f"Tool result for {tool_name}:\n{observation}\n\nContinue your investigation."
        })

    return "Max iterations reached. Partial diagnosis: " + str(messages[-1])


# ─────────────────────────────────────────────────────────────
# STEP 5: Run It
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    result = run_agent(
        "OSPF neighbor 3.3.3.3 is stuck in INIT state on rtr-01. "
        "Investigate and find the root cause."
    )
```

---

## 2.3 Run It

```bash
cd my-network-agent
export ANTHROPIC_API_KEY="your-key-here"   # or set in .env
python simple_agent.py
```

**Expected output:**
```
Agent starting: 'OSPF neighbor 3.3.3.3 is stuck in INIT state on rtr-01...'
============================================================

[Iteration 1] THOUGHT: OSPF INIT state means we're receiving Hellos but the
neighbor hasn't seen our Hellos yet. This is usually a one-way communication
issue...
ACTION: show_ospf_neighbors({'device': 'rtr-01'})
OBSERVATION: {"neighbors": [{"neighbor_id": "3.3.3.3", "state": "INIT", ...}]}

[Iteration 2] THOUGHT: Confirmed INIT state on Gi0/1. Let me check the interface.
ACTION: show_interface({'device': 'rtr-01', 'interface': 'Gi0/1'})
OBSERVATION: {"status": "up", "protocol": "up", "mtu": 1500, ...}

[Iteration 3] THOUGHT: Interface is UP. Let me check OSPF area configuration.
ACTION: check_ospf_config({'device': 'rtr-01', 'interface': 'Gi0/1'})
OBSERVATION: {"area": "1", ...}

FINAL ANSWER:
Root cause: OSPF area mismatch on rtr-01 Gi0/1.
- rtr-01 Gi0/1 is in OSPF area 1
- Neighbor 3.3.3.3 expects area 0 (this is your backbone area)
Recommended fix:
  interface GigabitEthernet0/1
   ip ospf 1 area 0
```

---

## 2.4 What Just Happened (Line by Line)

| What the code does | Why it matters |
|---|---|
| `TOOLS` dict maps names to functions | LLM sees the name+description, Python executes the function |
| `build_tool_descriptions()` | Injects tool list into the prompt at runtime |
| `parse_response()` | Extracts structured data from free-form LLM text |
| `messages.append(observation)` | Builds conversation history — this IS the agent's working memory |
| `for iteration in range(max_iterations)` | The reasoning loop — this is what frameworks like LangGraph formalize |

---

## 2.5 What Frameworks Add

Your simple agent works, but it has limitations:
- No persistent memory across sessions
- No conditional branching (if OSPF issue -> path A, if BGP issue -> path B)
- Hard to add a human approval checkpoint
- No observability — can't see what happened in structured format

LangGraph (Module 5) solves all of these by replacing your `for` loop with a proper state machine.

---

## Lab 2.1: Extend the Agent

Add a fifth tool to your agent:

```python
def show_bgp_summary(device: str) -> dict:
    """Get BGP neighbor summary."""
    # Your implementation here
    # Hint: Add demo data for "rtr-01" with at least one neighbor in "Established" state
    # and one in "Active" state
    pass
```

Then test with this query:
```python
run_agent("BGP neighbor on rtr-01 is in Active state. Why is it not establishing?")
```

The agent should use your new tool automatically — you don't need to tell it to.

---

## Lab 2.2: Add Iteration Tracking

Modify `run_agent` to return not just the answer but also a summary:
```python
{
    "answer": "...",
    "iterations": 3,
    "tools_used": ["show_ospf_neighbors", "show_interface", "check_ospf_config"],
    "confidence": "high"   # parse this from the LLM's final thought
}
```

---

## Module 2 Quiz

1. In the ReAct loop, what three things happen in each iteration?
2. Why do we append both the LLM output AND the tool observation to `messages`?
3. What happens if you set `max_iterations=1`? What does this tell you about the problem?
4. The agent called `check_ospf_config` — you didn't tell it to. How did it know?
5. What is the `parse_response()` function doing and why do we need it?

---

## What's Next

You've built the core of an agent from scratch. You can see it works — but the tools are fake. In Module 3, you'll build real tools that SSH into actual (or simulated) network devices.

**Module 3: The Tool Layer ->**


---

Module 2 · Lesson 4 — Inside Function Calling

Read time: ~6 min | Module 2 of 8 — Build Your First Agent

---

### The Part You Have Been Taking for Granted

In Lesson 3 you built a working agent. You called a tool, got a result, fed it back in. It worked. You probably did not stop to ask: how does the model know which tool to call, and with which arguments?

That question matters. When function calling breaks — and it will, at scale — you need to know where to look.

---

### The Model Does Not "Call" Anything

This is the most important misconception to clear up.

Claude does not execute code. It does not have access to your SSH session. It does not make HTTP requests. It cannot touch your router.

What Claude does is generate text. Specifically, when it decides a tool should be used, it generates a structured piece of text that describes the tool call it wants to make. Your code reads that text, parses it, and executes the actual function.

The flow:

```
Your code                       Claude
  |                               |
  |-- send messages + tool list -->|
  |                               |-- "I need to call get_ospf_neighbors"
  |                               |-- generates structured output:
  |                               |   {"tool": "get_ospf_neighbors",
  |                               |    "args": {"device": "client-rtr-01"}}
  |<-- returns that structured output --|
  |
  |-- your code parses it
  |-- your code calls get_ospf_neighbors("client-rtr-01")
  |-- your code gets the result
  |-- your code injects result back into messages
  |-- your code sends messages again -->
```

Claude never touches the router. Your code does. Claude only decides what should happen and expresses that decision as structured text.

---

### How Claude Knows What Tools Exist

You tell it. Every time. In the system prompt or as a tools parameter in the API call.

```python
tools = [
    {
        "name": "get_ospf_neighbors",
        "description": "Run 'show ip ospf neighbor detail' on a device and return parsed output.",
        "input_schema": {
            "type": "object",
            "properties": {
                "device": {
                    "type": "string",
                    "description": "Hostname of the device to query"
                }
            },
            "required": ["device"]
        }
    },
    {
        "name": "push_config_change",
        "description": "Push a configuration change to a device. Requires human approval before execution.",
        "input_schema": {
            "type": "object",
            "properties": {
                "device": {"type": "string"},
                "config": {"type": "string", "description": "IOS config block to apply"}
            },
            "required": ["device", "config"]
        }
    }
]
```

The model reads the `description` field to decide whether to use a tool. The `input_schema` tells it what arguments to generate. The quality of these descriptions directly controls the quality of tool selection.

Bad description: `"Gets OSPF data"` — the model does not know when to use it.
Good description: `"Run 'show ip ospf neighbor detail' on a device. Use this when investigating OSPF adjacency issues, neighbor state, or timer values."` — the model knows exactly when and why.

---

### What the Raw Tool Call Looks Like

When Claude decides to call a tool, the API response has a specific structure. LangChain handles this for you, but you should know what is underneath:

```python
response = anthropic_client.messages.create(
    model="claude-sonnet-4-6",
    messages=messages,
    tools=tools
)

# response.content is a list. Each element is either text or a tool_use block.
for block in response.content:
    if block.type == "tool_use":
        print(block.name)   # "get_ospf_neighbors"
        print(block.input)  # {"device": "client-rtr-01"}
```

Your agent loop reads that `tool_use` block, routes to the right function, executes it, and adds the result back:

```python
tool_result = {
    "type": "tool_result",
    "tool_use_id": block.id,
    "content": str(get_ospf_neighbors("client-rtr-01"))
}

messages.append({"role": "assistant", "content": response.content})
messages.append({"role": "user",      "content": [tool_result]})
```

The `tool_use_id` links the result back to the specific tool call that requested it. If the agent called three tools in one turn, each result is matched back to its call by ID.

---

### Where It Breaks and How to Fix It

**Problem 1: The model generates invalid JSON**

At temperature 0 this is rare, but it happens. The model outputs a tool call block where the arguments are malformed — a string where an object is expected, a missing required field.

```python
# Fragile
args = json.loads(block.input)
device = args["device"]

# Robust
try:
    args = block.input if isinstance(block.input, dict) else json.loads(block.input)
    device = args.get("device", "")
    if not device:
        raise ValueError("tool call missing required 'device' argument")
except (json.JSONDecodeError, ValueError) as e:
    # Feed the error back to the model as a tool_result
    tool_result = {
        "type": "tool_result",
        "tool_use_id": block.id,
        "content": f"Error: {e}. Please retry with valid arguments.",
        "is_error": True
    }
```

When you feed the error back as a `tool_result` with `is_error: True`, Claude will see what went wrong and retry with corrected arguments on the next turn. Do not raise an exception and crash. Feed the error back into the loop.

**Problem 2: The model calls a tool you did not define**

This should not happen if your tool list is complete. But if you are extending your agent and forgot to add a new tool to the list, Claude will sometimes attempt to call it anyway (hallucinated tool call). The fix:

```python
REGISTERED_TOOLS = {
    "get_ospf_neighbors": get_ospf_neighbors,
    "push_config_change": push_config_change,
    "get_bgp_summary": get_bgp_summary,
}

if block.name not in REGISTERED_TOOLS:
    return {"type": "tool_result", "tool_use_id": block.id,
            "content": f"Tool '{block.name}' is not available.",
            "is_error": True}

result = REGISTERED_TOOLS[block.name](**block.input)
```

**Problem 3: The model does not call any tool**

The model returns a text response instead of a tool call. This usually means the tool descriptions did not match the task — the model did not recognise that a tool was the right action.

Diagnosis: add `print(response.content)` and read what Claude said instead. It will tell you why it did not use a tool. Often it is because the task is ambiguous or the tool description is too narrow.

Fix: improve the description. Add examples: `"Use this when: neighbor is in INIT, EXSTART, or EXCHANGE state."` Explicit triggers in descriptions significantly improve tool selection accuracy.

---

### The Description Is the Interface

This is the design insight that separates agents that work from agents that do not.

You design APIs by defining what endpoints do and what parameters they accept. The consumer reads the docs and knows how to call it.

For an LLM agent, the tool description IS the API documentation. Claude reads it at runtime and decides whether and how to call your function. If the description is ambiguous, Claude will misuse the tool. If it is missing key information, Claude will skip the tool when it should use it.

```python
# Weak description — will be underused
"description": "Checks OSPF."

# Strong description — will be used correctly
"description": (
    "Retrieve the current OSPF neighbor table and interface status for a device. "
    "Use this tool first when: neighbor is stuck in any non-FULL state (INIT, 2WAY, "
    "EXSTART, EXCHANGE, LOADING), when the agent suspects a timer or area mismatch, "
    "or when the agent needs to verify current adjacency state after a config change."
)
```

Write your tool descriptions the way you would write runbook steps for a junior engineer. Be specific about when to use it, not just what it does.

---

Module Challenge: Open your Module 2 notebook. Find your tool definition. Rewrite the description field using the strong format above: what it does + explicit "use when" triggers. Run the agent again with the same scenario. Did it call the tool faster (fewer reasoning turns before using it)? Post your before/after descriptions in #agent-builds.

Community: skool.com/autonomous-msp-2162
