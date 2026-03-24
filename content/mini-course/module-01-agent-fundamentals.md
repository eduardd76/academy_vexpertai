# Module 1: Agent Fundamentals
### The Mental Model Before the Code

**Duration:** 45 minutes
**No code required** — this module builds the mental model you need for every module that follows.

---

## 1.1 Why Scripts Are Not Enough

You've been automating networks for years. Ansible playbooks, Python Netmiko scripts, even Nornir workflows. They work — until they don't.

The moment your network hits a state that wasn't in the script, the automation fails silently or loudly, and a human has to take over. The script doesn't know *why* it failed. It can't form a hypothesis. It can't adapt.

Consider a real scenario:

```
Script: Check OSPF neighbor state
Script: State is DOWN
Script: [If DOWN] -> Check interface
Script: Interface is UP
Script: [If interface UP] -> Alert "Unknown OSPF failure"
Script: Exit.
```

A senior network engineer would not stop there. They would:
- Check OSPF timers
- Check the area configuration
- Look at what changed in the last 24 hours
- Form a hypothesis: "area mismatch? authentication issue? MTU mismatch?"
- Test each hypothesis systematically
- Find the root cause

That reasoning process — hypothesis formation, systematic investigation, adaptation — is what an AI agent does.

---

## 1.2 The Formal Definition

An AI agent is an **autonomous computational entity** that:

| Capability | What It Means | Networking Analogy |
|---|---|---|
| **Perceives** | Reads environment via tools/APIs | Running `show` commands |
| **Remembers** | Maintains state across interactions | Your mental model of the network |
| **Reasons** | Forms hypotheses using an LLM | Thinking through the OSI model |
| **Acts** | Executes tools to change state | Pushing a config change |
| **Adapts** | Learns from outcomes | "Last time this happened, it was X" |

The key insight: **the LLM is the brain, not the product.**

The LLM (Claude, GPT-4, or a local Qwen model) is just the reasoning engine inside the agent. The agent architecture around it — memory, tools, state machine — is what makes it useful for network operations.

---

## 1.3 The Perception-Action Cycle

Every agent, no matter how complex, runs this loop:

```
┌─────────────────────────────────────────────────┐
│              ENVIRONMENT                         │
│         (Your Network Infrastructure)            │
└─────────────┬─────────────────┬─────────────────┘
              │                 │
        PERCEPTION          ACTION
       (SSH, APIs, SNMP)   (Config push, alerts)
              │                 │
              ↓                 ↑
┌─────────────────────────────────────────────────┐
│                 AGENT                            │
│  ┌─────────────────────────────────────────┐   │
│  │         REASONING ENGINE (LLM)          │   │
│  │  1. What do I observe?                  │   │
│  │  2. What does this mean?                │   │
│  │  3. What should I do next?              │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │             MEMORY                      │   │
│  │  - Current task context                 │   │
│  │  - Past incidents                       │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

This loop runs until the agent reaches a conclusion with sufficient confidence, or until you tell it to stop.

---

## 1.4 The Four Pillars

Every production-grade network agent needs these four components. Think of them as the four layers of your agent's architecture — just like you think in layers when designing a network.

### Pillar 1: Reasoning Engine
The LLM. This is what makes the agent intelligent rather than just automated.

- Analyzes observations
- Forms hypotheses
- Decides which tool to call next
- Generates the final answer

**Choice:** Claude Sonnet 4 (cloud, best reasoning), Qwen 2.5:7B (local, free, private).
Use local for common patterns, escalate to cloud when confidence is low.

### Pillar 2: Memory Systems
The agent's experience. Without memory, every session starts from zero.

| Type | Stores | Example |
|---|---|---|
| Working | Current task state | "I've checked interfaces, BGP is UP, now checking route table" |
| Episodic | Past sessions | "INC-2341: BGP down was caused by firewall blocking TCP 179" |
| Semantic | Protocol facts | "OSPF uses IP protocol 89, not TCP/UDP" |
| Procedural | How-to guides | Your internal SOPs, runbooks |

### Pillar 3: Tools (Skills)
The agent's hands. What it can actually DO in your network.

- **READ tools:** `show ip ospf neighbor`, `show bgp summary` (always safe, auto-execute)
- **WRITE tools:** `push_config`, `apply_acl` (require your approval)
- **ADMIN tools:** `reload`, `factory_reset` (require explicit confirmation)

Never give a WRITE tool auto-execute permission. This is non-negotiable.

### Pillar 4: Context (Knowledge Base)
The agent's grounding in YOUR environment. Three layers:

1. **MCP Server** — Live standards: "We use OSPF, not EIGRP. Change freeze is active."
2. **RAG (Vector DB)** — Your documentation, past tickets, vendor guides
3. **Knowledge Graph** — Your network topology modeled as nodes and edges

Without this layer, the agent reasons about a generic network. With it, it reasons about YOUR network.

---

## 1.5 Reasoning Patterns

The LLM inside your agent can reason in different modes. Choose the right mode for the job.

### ReAct — Troubleshooting
*Reason + Act, iteratively.*

```
Thought: OSPF neighbor is DOWN. Could be L1/L2 issue, timer mismatch, or area config.
Action: run_show_command(device="rtr-01", command="show interfaces Gi0/0")
Observation: Interface is UP/UP, no errors.
Thought: L1/L2 is fine. Let me check OSPF configuration.
Action: run_show_command(device="rtr-01", command="show ip ospf interface Gi0/0")
Observation: Area 1, but neighbor config shows Area 0.
Thought: Area mismatch confirmed. Root cause found.
```

Use for: troubleshooting, incident investigation, root cause analysis.

### Planning — Config Generation
*Break the goal into steps, execute in order.*

```
Goal: Deploy OSPF on new branch router

Plan:
  Step 1: Get IP addressing from NetBox
  Step 2: Get OSPF area assignment from MCP standards server
  Step 3: Generate Cisco IOS config
  Step 4: Run reflection critique on generated config
  Step 5: Present diff to human for approval
  Step 6: Apply (if approved)
  Step 7: Verify neighbor adjacency
```

Use for: change generation, network design, onboarding new sites.

### Reflection — Quality Assurance
*Generate, then critique your own output.*

```
Generated ACL:
  permit ip any any

Reflection:
  CRITICAL: permit any any is insecure.
  The requirement was to restrict, not permit everything.

Revised ACL:
  deny ip 10.0.0.0 0.255.255.255 any log
  permit ip 192.168.0.0 0.0.255.255 any
  deny ip any any log
```

Use for: config validation, compliance checking, before any human review.

### Human-in-the-Loop — Production Changes
*Always pause before touching production.*

```
AGENT CHECKPOINT:
  Diagnosis: OSPF area mismatch on rtr-01 Gi0/0
  Proposed fix:
    interface GigabitEthernet0/0
     ip ospf 1 area 0
  Confidence: 94%
  Risk: Low — non-disruptive OSPF config change

  [APPROVE] / [REJECT] / [EXPLAIN MORE]
```

Use for: ANY operation that modifies production network state.

---

## 1.6 The Pattern Selection Matrix

| If You Are Doing | Use This Pattern |
|---|---|
| Troubleshooting an incident | ReAct |
| Generating a config | Planning + Reflection |
| Validating a config | Reflection |
| Applying a change | Human-in-the-Loop |
| Complex cross-domain design | Multi-Agent |

In practice, your agent uses **multiple patterns in one session.** It might use ReAct to diagnose, Planning + Reflection to generate the fix, then Human-in-the-Loop to apply it.

---

## 1.7 Agents vs Automation: The Summary Table

| Dimension | Traditional Script | AI Agent |
|---|---|---|
| What drives it | Pre-written if-then logic | LLM reasoning |
| When it fails | Any unexpected state | Almost never — it adapts |
| Error handling | Crashes or alerts | Tries alternative approaches |
| New situations | Must be reprogrammed | Handles them gracefully |
| Explains itself | No | Yes — full reasoning trace |
| Learns over time | No | Yes — episodic memory |
| Cost | Free to run | LLM API cost (~$0.01-0.10 per query) |

---

## Module 1 Quiz

1. What are the four pillars of an AI agent architecture?
2. You need to troubleshoot a BGP flap. Which reasoning pattern do you use and why?
3. Why should WRITE tools require human approval, but READ tools can auto-execute?
4. A colleague says: "An AI agent is just a chatbot with SSH access." What's wrong with this statement?
5. What is the difference between working memory and episodic memory in an agent?

*Answers: Review sections 1.4 and 1.5 — all answers are in the module text.*

---

## What's Next

You now have the mental model. In Module 2, you will build a minimal agent loop from scratch in pure Python — no frameworks, no magic — so you understand exactly what frameworks like LangGraph are doing under the hood.

**Module 2: Your First Agent in Pure Python ->**


---

Module 1 · Lesson 4 — How LLMs Actually Work

Read time: ~7 min | Module 1 of 8 — Agent Fundamentals

---

### Why This Lesson Exists

You have been using Claude in this course as a black box. That works — until it does not. When your agent gives a wrong diagnosis, hallucinates a config command, or runs out of memory mid-investigation, you need to know what is actually happening inside.

This lesson opens the box. Not the math — you do not need the math. The mental model. The same way you do not need to understand TCP's congestion control algorithm to diagnose a slow WAN link, but you do need to understand windows and retransmission.

---

### What an LLM Actually Receives

Every time your agent calls Claude, it sends a structured list of messages. Not one big text string. A list with roles.

```python
messages = [
    {
        "role": "system",
        "content": "You are an OSPF troubleshooting agent for a managed service provider..."
    },
    {
        "role": "user",
        "content": "OSPF neighbor 3.3.3.3 on client-rtr-01 is in INIT state for 20 minutes."
    },
    {
        "role": "assistant",
        "content": "I will check the neighbor detail and interface config on Gi0/1."
    },
    {
        "role": "user",
        "content": "show ip ospf neighbor detail output: Hello timer 10s, Dead timer 40s"
    }
]
```

Three roles. Each one does a different job.

**system** — The standing order. Personality, constraints, output format, what the agent knows about itself. Written once per session. Think of it as the job description handed to a new engineer before they pick up their first ticket.

**user** — Everything that comes from outside the model. Your prompt. Tool output. The OSPF show command result. Even though it says "user," in an agent it is mostly your code injecting data.

**assistant** — What the model said in previous turns. When you have a multi-step agent loop, you replay the full conversation history so the model remembers what it already did. There is no other memory between calls.

---

### The Context Window Is a Sliding Window, Not Infinite RAM

Every LLM has a context window — a maximum number of tokens it can hold at one time. Claude's is large (200,000 tokens). But it is still a limit.

Networking analogy: the context window is like your engineer's working memory during an active troubleshooting session. They can hold maybe 8-10 facts at once while actively debugging. Once the session ends, the state is gone. The next ticket starts fresh.

For your agent, this means:

- Everything the agent "knows" during a run lives in the message list
- Long show command outputs, full routing tables, large topology dumps — they all consume context space
- When context fills up, older messages get dropped from the start of the list

This is why Module 6's context layer matters. You are not just adding topology data for intelligence. You are making deliberate choices about what deserves limited context space.

**What counts as a token:**

A token is roughly 3/4 of a word in English. "GigabitEthernet0/1" is about 6 tokens. A `show ip bgp summary` output with 200 prefixes might be 800 tokens. The REASON_PROMPT from Module 8 with all fields filled in is roughly 400 tokens per call.

At 10 observe/reason iterations, that is 4,000 tokens in prompts alone — well within limits. But if you dump a full running config (3,000 lines) into every observation, you will hit limits and degrade performance fast.

Rule: inject only what the model needs for the current reasoning step. Not everything you have access to.

---

### Temperature: Why It Is Always 0 on a Live Network

Temperature controls how random the model's output is. High temperature (0.8-1.0) = more creative, more varied. Temperature 0 = deterministic, always picks the most probable next token.

```python
llm = ChatAnthropic(
    model="claude-sonnet-4-6",
    temperature=0   # <-- always this for network automation
)
```

Why temperature 0 for network agents?

Consider what happens at temperature 0.7 when your agent proposes a config fix. Two engineers run the same incident. The model proposes slightly different fixes each time. One works. One causes an outage. Neither engineer knows why the outputs differed.

At temperature 0, the same input produces the same output every time. That makes your agent:

- **Auditable** — you can replay an incident and get the same reasoning
- **Debuggable** — wrong output = wrong input, not random variation
- **Trustworthy to operators** — behavior is consistent, not surprising

The only time to raise temperature is when you want creative output — brainstorming, writing documentation, generating test cases. Never for decisions that touch production configs.

---

### The Model Family: Which Claude for Which Task

Not every task needs the most powerful model. This matters because cost scales with capability.

```
Claude Opus      — Deep reasoning, complex multi-step analysis
                   Cost: high | Use: capstone agent REASON node

Claude Sonnet    — Strong reasoning, faster, cheaper
                   Cost: medium | Use: most agent nodes

Claude Haiku     — Fast, very cheap, good for simple tasks
                   Cost: low | Use: OBSERVE node (just picking show commands)
```

For your OSPF agent:

```python
# observe node — just picking which commands to run
observe_llm = ChatAnthropic(model="claude-haiku-4-5-20251001", temperature=0)

# reason node — root cause analysis, confidence score
reason_llm  = ChatAnthropic(model="claude-sonnet-4-6", temperature=0)
```

This pattern — routing different agent nodes to different model tiers — reduces cost per ticket by 40-60% with no accuracy loss on the simpler steps. We cover this in depth in Series 2. For now, just know the option exists.

---

### What the Model Does Not Know

Two things your agent must always provide explicitly — they are not in the model by default:

**1. Your client's network**

Claude has read every public Cisco TAC document, every RFC, every network engineering blog post. It understands OSPF area mechanics, BGP path selection, VLAN trunking. But it has never seen your client's topology, their change history, their vendor quirks, or their naming conventions.

This is what Modules 4, 5, and 6 provide: the mechanism to inject client-specific knowledge into every reasoning step.

**2. Real-time state**

Claude's training data has a cutoff. It does not know what is currently running on client-rtr-01. It does not know the show command output unless your tool fetched it and injected it.

The agent's job is not to answer from memory. It is to gather evidence (OBSERVE), reason about it (REASON), and propose action grounded in what it actually found — not what it guesses.

When you see an agent hallucinate a config that does not match the device, almost always the root cause is: the agent reasoned without enough injected evidence. It filled in the gaps from training data. The fix is more tool calls, not a smarter model.

---

### The Mental Model in One Sentence

An LLM is a very capable reasoning engine that processes one context window at a time, knows networking theory from training, knows nothing about your specific environment, and produces consistent output at temperature 0 — which is why your job is to build the tools and memory systems that give it the right evidence to reason from.

---

Module Challenge: Open your Module 2 notebook. Add a `print(messages)` call before your LLM invocation. Run the agent. Look at what you are actually sending. Count the roles. Read the system prompt. Most engineers have never looked at this before. Post in #agent-builds: how many messages did your first LLM call contain?

Community: skool.com/autonomous-msp-2162
