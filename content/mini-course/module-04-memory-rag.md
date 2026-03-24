# Module 4: Memory and RAG
### Give Your Agent a Long-Term Memory

**Duration:** 1.5 hours
**What you build:** `memory/` folder — ChromaDB knowledge base, episodic incident memory, and semantic protocol facts.

---

## 4.1 Why Memory Changes Everything

Without memory, every session your agent starts from zero. Ask it "why is BGP flapping on rtr-03?" and it has no idea that this exact problem happened three months ago, the root cause was a misconfigured route-map, and the fix took 4 hours.

With episodic memory:
```
Agent: "BGP neighbor down on rtr-03."
Agent: [searches memory] "Found similar incident INC-2341 from 2025-11.
        Root cause: route-map CUSTOMER-OUT was rejecting all prefixes after a
        policy change. Let me check route-maps first."
```

Instead of 20 minutes of investigation, the agent goes straight to the right check. This compounds over time — the more incidents you feed in, the smarter the agent gets.

---

## 4.2 The Four Memory Types in Your Agent

| Type | What It Stores | Storage | Used When |
|---|---|---|---|
| Working | Current task state, reasoning trace | Python dict in RAM | Every reasoning step |
| Episodic | Past incidents, resolutions | ChromaDB (vector) | Start of troubleshooting |
| Semantic | Protocol facts, your standards | ChromaDB (vector) | Every query |
| Procedural | SOPs, runbooks, change templates | ChromaDB (vector) | Planning phase |

Working memory is handled automatically by LangGraph (Module 5). This module builds the other three using ChromaDB.

---

## 4.3 How RAG Works (The Simple Version)

```
Your documentation + past incidents
          |
          v
    EMBED (convert to vectors)
          |
          v
    STORE in ChromaDB

At query time:

    User asks: "OSPF neighbor in INIT state"
          |
          v
    EMBED the query (same embedding model)
          |
          v
    FIND most similar vectors in ChromaDB
          |
          v
    RETURN top 3 matching documents
          |
          v
    INJECT into LLM prompt as context
```

The magic: you don't need exact keyword matches. "OSPF adjacency not forming" will find documents about "OSPF neighbors stuck in EXSTART" because the *meaning* is similar.

---

## 4.4 Set Up the Knowledge Base

Create `my-network-agent/memory/vector_store.py`:

```python
import chromadb
from chromadb.utils import embedding_functions
import os


def get_chroma_client(persist_path: str = "./agent_memory_db") -> chromadb.PersistentClient:
    """Get a persistent ChromaDB client. Data survives between sessions."""
    return chromadb.PersistentClient(path=persist_path)


def get_or_create_collection(client: chromadb.PersistentClient, name: str):
    """Get existing collection or create it fresh."""
    # Using the default embedding function (all-MiniLM-L6-v2 — free, runs locally)
    embedding_fn = embedding_functions.DefaultEmbeddingFunction()
    return client.get_or_create_collection(
        name=name,
        embedding_function=embedding_fn,
        metadata={"hnsw:space": "cosine"},  # cosine similarity for semantic search
    )


class NetworkKnowledgeBase:
    """
    Manages three collections:
    - incidents: past troubleshooting sessions with root causes
    - protocols: networking facts, vendor documentation snippets
    - standards: your organisation's standards and policies
    """

    def __init__(self, persist_path: str = "./agent_memory_db"):
        self.client = get_chroma_client(persist_path)
        self.incidents = get_or_create_collection(self.client, "incidents")
        self.protocols = get_or_create_collection(self.client, "protocols")
        self.standards = get_or_create_collection(self.client, "standards")

    # ─────────────────────────────────────────
    # Indexing methods
    # ─────────────────────────────────────────

    def index_incident(self, incident_id: str, description: str, root_cause: str,
                       resolution: str, device: str = "", protocol: str = ""):
        """Index a past incident so the agent can recall similar problems."""
        # The document is what gets embedded for similarity search
        document = f"{description}\nRoot cause: {root_cause}"
        self.incidents.upsert(
            ids=[incident_id],
            documents=[document],
            metadatas=[{
                "incident_id": incident_id,
                "root_cause": root_cause,
                "resolution": resolution,
                "device": device,
                "protocol": protocol,
            }],
        )
        print(f"Indexed incident: {incident_id}")

    def index_protocol_fact(self, fact_id: str, fact: str, protocol: str, tags: list = None):
        """Index a networking fact or documentation snippet."""
        self.protocols.upsert(
            ids=[fact_id],
            documents=[fact],
            metadatas=[{
                "protocol": protocol,
                "tags": ",".join(tags or []),
            }],
        )

    def index_standard(self, standard_id: str, content: str, category: str):
        """Index an organisational standard or policy."""
        self.standards.upsert(
            ids=[standard_id],
            documents=[content],
            metadatas=[{"category": category}],
        )

    # ─────────────────────────────────────────
    # Query methods
    # ─────────────────────────────────────────

    def find_similar_incidents(self, problem_description: str, n_results: int = 3) -> list:
        """Find past incidents similar to the current problem."""
        results = self.incidents.query(
            query_texts=[problem_description],
            n_results=min(n_results, self.incidents.count()),
        )
        if not results["ids"][0]:
            return []

        incidents = []
        for i, doc_id in enumerate(results["ids"][0]):
            meta = results["metadatas"][0][i]
            incidents.append({
                "incident_id": meta["incident_id"],
                "similarity": 1 - results["distances"][0][i],  # convert distance to similarity
                "root_cause": meta["root_cause"],
                "resolution": meta["resolution"],
                "device": meta.get("device", ""),
            })
        return incidents

    def find_relevant_facts(self, query: str, n_results: int = 5) -> list:
        """Find protocol facts relevant to the current query."""
        if self.protocols.count() == 0:
            return []
        results = self.protocols.query(
            query_texts=[query],
            n_results=min(n_results, self.protocols.count()),
        )
        return [
            {"fact": doc, "protocol": meta["protocol"]}
            for doc, meta in zip(results["documents"][0], results["metadatas"][0])
        ]

    def get_context_for_query(self, query: str) -> str:
        """
        Build a complete context block to inject into the agent prompt.
        Combines similar incidents + relevant facts.
        """
        parts = []

        incidents = self.find_similar_incidents(query, n_results=2)
        if incidents:
            parts.append("SIMILAR PAST INCIDENTS:")
            for inc in incidents:
                score = inc["similarity"]
                if score > 0.5:  # Only include reasonably similar incidents
                    parts.append(
                        f"  [{inc['incident_id']}] (similarity: {score:.0%})\n"
                        f"    Root cause: {inc['root_cause']}\n"
                        f"    Resolution: {inc['resolution']}"
                    )

        facts = self.find_relevant_facts(query, n_results=3)
        if facts:
            parts.append("\nRELEVANT PROTOCOL FACTS:")
            for f in facts:
                parts.append(f"  - {f['fact']}")

        return "\n".join(parts) if parts else ""
```

---

## 4.5 Seed the Knowledge Base

Create `my-network-agent/memory/seed_data.py`:

```python
from memory.vector_store import NetworkKnowledgeBase


def seed_demo_knowledge(kb: NetworkKnowledgeBase):
    """Load demo knowledge to test the agent."""

    # ─── Past Incidents ───────────────────────────────────────────

    kb.index_incident(
        incident_id="INC-2341",
        description="BGP neighbor down on rtr-03. All BGP sessions to AS 65002 dropped suddenly.",
        root_cause="Route-map CUSTOMER-OUT was modified during maintenance window and started "
                   "rejecting all advertised prefixes, causing BGP to drop the session after "
                   "sending NOTIFICATION.",
        resolution="Removed the incorrect deny statement from route-map CUSTOMER-OUT. "
                   "BGP sessions recovered in 90 seconds.",
        device="rtr-03",
        protocol="bgp",
    )

    kb.index_incident(
        incident_id="INC-2187",
        description="OSPF neighbor stuck in EXSTART state between core-rtr-01 and core-rtr-02.",
        root_cause="MTU mismatch. core-rtr-01 Gi0/0 had MTU 1500, core-rtr-02 Gi0/0 had MTU 9000 "
                   "(jumbo frames enabled for storage traffic). OSPF uses MTU in DBD exchange.",
        resolution="Standardised MTU to 9000 on both interfaces, or alternatively added "
                   "'ip ospf mtu-ignore' on the interface as a workaround.",
        device="core-rtr-01",
        protocol="ospf",
    )

    kb.index_incident(
        incident_id="INC-2089",
        description="OSPF neighbor in INIT state. One-way adjacency problem.",
        root_cause="ACL on the firewall between the two routers was blocking OSPF multicast "
                   "traffic (224.0.0.5) in one direction only. Router A could receive Hellos "
                   "from Router B but Router B's Hellos never reached Router A.",
        resolution="Added permit rule for OSPF multicast 224.0.0.5 in both directions on "
                   "the firewall policy.",
        device="edge-fw-01",
        protocol="ospf",
    )

    kb.index_incident(
        incident_id="INC-1983",
        description="BGP session flapping every 3 minutes on border router.",
        root_cause="Hold timer mismatch. Our router was configured with hold-time 180s but the "
                   "peer's keepalive was 60s. The negotiated hold time was 60s, but high CPU "
                   "on the peer was causing keepalives to be delayed, triggering hold-timer expiry.",
        resolution="Aligned BGP timers: 'neighbor X timers 30 90' on both sides.",
        device="border-rtr-01",
        protocol="bgp",
    )

    # ─── Protocol Facts ───────────────────────────────────────────

    kb.index_protocol_fact(
        fact_id="ospf-states",
        fact="OSPF neighbor states in order: DOWN -> ATTEMPT -> INIT -> 2WAY -> EXSTART -> EXCHANGE -> LOADING -> FULL. "
             "INIT means we received a Hello but our Router ID is not in the neighbor's Hello. "
             "This usually indicates one-way communication — a firewall, ACL, or multicast routing issue.",
        protocol="ospf",
        tags=["neighbor", "states", "troubleshooting"],
    )

    kb.index_protocol_fact(
        fact_id="ospf-exstart",
        fact="OSPF EXSTART state means the Master/Slave election is stuck. "
             "Most common cause: MTU mismatch. Check 'show ip ospf interface' and compare MTU values. "
             "Workaround: ip ospf mtu-ignore on the interface.",
        protocol="ospf",
        tags=["exstart", "mtu", "troubleshooting"],
    )

    kb.index_protocol_fact(
        fact_id="bgp-notification-codes",
        fact="BGP NOTIFICATION message reason codes: "
             "1=Message Header Error, 2=OPEN Message Error, 3=UPDATE Message Error, "
             "4=Hold Timer Expired, 5=Finite State Machine Error, 6=Cease. "
             "Subcode 6/7 = Connection Collision Resolution (normal during dual-session startup). "
             "Subcode 4/2 = Authentication failure.",
        protocol="bgp",
        tags=["notification", "error-codes", "troubleshooting"],
    )

    kb.index_protocol_fact(
        fact_id="ospf-area-types",
        fact="OSPF area types: Backbone (area 0), Standard, Stub (no external LSAs), "
             "Totally Stub (no external or inter-area LSAs), NSSA (can have external LSAs via type-7). "
             "Area mismatch: if routers have different area types configured, adjacency will not form.",
        protocol="ospf",
        tags=["areas", "stub", "nssa", "design"],
    )

    # ─── Organisational Standards ─────────────────────────────────

    kb.index_standard(
        standard_id="routing-std-001",
        content="Routing protocol standard: OSPF process 1, backbone area 0 for all core links. "
                "Access/distribution links use area 1-10 by site. EIGRP is NOT used. "
                "BGP used only for WAN and data centre interconnect.",
        category="routing",
    )

    kb.index_standard(
        standard_id="change-mgmt-001",
        content="Change management: all configuration changes require a change ticket. "
                "Emergency changes allowed with post-notification within 2 hours. "
                "Change freeze active December 15 - January 10 annually.",
        category="process",
    )

    print("Knowledge base seeded successfully.")
    print(f"  Incidents: {kb.incidents.count()}")
    print(f"  Protocol facts: {kb.protocols.count()}")
    print(f"  Standards: {kb.standards.count()}")


if __name__ == "__main__":
    kb = NetworkKnowledgeBase()
    seed_demo_knowledge(kb)
```

---

## 4.6 Test the Memory

Create `my-network-agent/memory/test_memory.py`:

```python
from memory.vector_store import NetworkKnowledgeBase
from memory.seed_data import seed_demo_knowledge


def test_memory():
    kb = NetworkKnowledgeBase()
    seed_demo_knowledge(kb)

    print("\n" + "=" * 60)
    print("TEST 1: OSPF INIT state query")
    print("=" * 60)
    context = kb.get_context_for_query("OSPF neighbor stuck in INIT state")
    print(context)

    print("\n" + "=" * 60)
    print("TEST 2: BGP session dropping")
    print("=" * 60)
    context = kb.get_context_for_query("BGP neighbor dropping sessions unexpectedly")
    print(context)

    print("\n" + "=" * 60)
    print("TEST 3: MTU problem")
    print("=" * 60)
    context = kb.get_context_for_query("OSPF EXSTART state, neighbors won't form full adjacency")
    print(context)


if __name__ == "__main__":
    test_memory()
```

Run it:
```bash
python memory/test_memory.py
```

Expected: The OSPF INIT query should surface INC-2089 (firewall blocking multicast) and the `ospf-states` fact.

---

## 4.7 What to Index vs What NOT to Index

This is the most common mistake with RAG. The LLM already knows networking. Don't waste your index on things it already knows.

**Index these (device-specific, organisation-specific facts):**
- Device hostnames, IPs, interfaces, OSPF areas
- Past incidents with root causes and resolutions
- Your BGP AS numbers, communities, route-map names
- Your IP addressing plan and VLAN assignments
- Your organisation's standards ("we use OSPF area 0 for the backbone")
- Vendor release notes with known bugs for your firmware versions

**Do NOT index these (the LLM already knows this):**
- "OSPF uses a link-state algorithm"
- "BGP is a path-vector protocol"
- How to configure OSPF step by step
- General networking theory

**The test:** Ask yourself: "Would a senior Cisco CCIE know this without looking it up?" If yes — don't index it. If it's specific to your environment or a past incident — index it.

---

## Lab 4.1: Index Your Own Incidents

Take 3 real incidents from your ticketing system and add them to the knowledge base:

```python
kb.index_incident(
    incident_id="INC-XXXX",
    description="[What the problem looked like from the outside]",
    root_cause="[What actually caused it]",
    resolution="[What you did to fix it]",
    device="[which device was affected]",
    protocol="[ospf/bgp/vlan/etc]",
)
```

Then query: does the agent recall them correctly when you describe a similar problem?

---

## Lab 4.2: Episodic Memory Scoring

The `find_similar_incidents()` function returns a similarity score (0.0 to 1.0). Run this:

```python
kb = NetworkKnowledgeBase()
seed_demo_knowledge(kb)

test_queries = [
    "OSPF neighbor is not forming adjacency",
    "BGP peer is flapping",
    "VLAN traffic not passing between switches",  # nothing in our KB about this
    "OSPF EXSTART, neighbors won't go FULL",
]

for query in test_queries:
    incidents = kb.find_similar_incidents(query, n_results=1)
    if incidents and incidents[0]["similarity"] > 0.5:
        print(f"Query: '{query}' -> matched {incidents[0]['incident_id']} ({incidents[0]['similarity']:.0%})")
    else:
        print(f"Query: '{query}' -> no confident match")
```

Notice how the VLAN query returns no confident match — the agent won't fabricate a memory that doesn't exist.

---

## Module 4 Quiz

1. What is the difference between episodic memory and semantic memory in your agent?
2. Why do we use cosine similarity instead of exact keyword search for the knowledge base?
3. You have a 500-page Cisco OSPF configuration guide. Should you index the whole thing? What should you index from it?
4. The similarity score for a query is 0.35. Should the agent use this result? Why or why not?
5. After running `seed_demo_knowledge()`, you restart Python and run the query again. Does it still return results? Why?

---

## What's Next

You have tools (Module 3) and memory (Module 4). Now you need the reasoning engine that ties them together — the state machine that manages OBSERVE -> REASON -> ACT cycles and decides when to loop vs when to finish.

**Module 5: LangGraph — The Reasoning Loop ->**


---

Module 4 · Lesson 1 — Why Memory Changes Everything for MSPs

Read time: ~6 min | Module 4 of 8

---

### The Problem: Every Session Starts From Zero

You open a ticket. BGP is down on client-03. You ask the agent.

Without memory, here is what the agent knows: BGP RFC. How BGP works in theory. General troubleshooting steps.

Here is what it does NOT know:
- That client-03 is running IOS-XE 17.6.3 and has a known route-map quirk after every maintenance window
- That you fixed this exact issue 14 months ago. Ticket INC-1847.
- That the resolution took 4 hours because nobody documented the route-map before the change.

The agent gives you textbook BGP troubleshooting. You already know the textbook. You needed the institutional memory.

With memory, the agent says: "BGP flapping on client-03. Similar to INC-1847 from 14 months ago — root cause was route-map CUSTOMER-OUT rejecting all prefixes after maintenance. Similarity: 0.87."

That is the difference.

---

### The 4 Memory Types — Mapped to MSP Reality

Working Memory — what the agent holds right now
The current context window. The current ticket, the show output you just ran. Disappears when the session ends. Short-lived by design.

Episodic Memory — past incidents
"I have seen this before." Specific events tied to a client, a date, a device. Your ticketing history, structured and searchable by meaning. This is what ChromaDB will store.

Semantic Memory — protocol and technology facts
BGP path selection rules. OSPF LSA types. How VXLAN works. The LLM already has this from training. Do not index it — wasting storage on things the model already knows degrades retrieval quality.

Procedural Memory — your SOPs
Your 6-step OSPF adjacency check. Your firmware upgrade rollback procedure. These belong in ChromaDB as procedures, not incidents.

---

### How RAG Works — Plain English

RAG stands for Retrieval-Augmented Generation. Here is what actually happens:

Step 1 — Embed. You take a text string — "BGP neighbor down, route-map rejecting prefixes after maintenance" — and convert it into a list of numbers (a vector). ChromaDB does this automatically using an embedding model built in.

Think of it like this: every text string gets converted to coordinates in a very large space. "BGP session flapping after change window" and "BGP neighbor dropped after maintenance" end up at nearby coordinates — because they mean the same thing.

Step 2 — Store. You save that vector plus the original text plus metadata (resolution, device, protocol) to disk. ChromaDB manages all of this.

Step 3 — Search by meaning. When a new incident comes in, you embed that query and find vectors that are numerically close to it. Close vectors = similar meaning.

Why this beats keyword search:

A keyword search for "OSPF adjacency not forming" will not find a ticket titled "OSPF stuck in EXSTART state." The words are different. A semantic search will — because both phrases describe the same failure mode. The embedding model has learned that they live in the same region of meaning-space.

For MSP troubleshooting this matters. Engineers write tickets differently. The agent does not care. It searches by meaning.

---

### The MSP Multiplier Effect

Without memory: engineer A spends 3 hours finding a weird OSPF bug. Engineer B hits the same thing next month. Starts from zero. Another 3 hours.

With a shared knowledge base: the fix for client-A automatically improves the agent's response for client-B. Index the incident once. Every future query against a similar symptom retrieves that resolution.

One MSP with 5 years of tickets in ChromaDB has a different agent than an MSP that started indexing last week. That gap grows every month.

---

Lesson 2 next: Setting up ChromaDB and indexing your first incidents.


---

Module 4 · Lesson 2 — Setting Up ChromaDB

Read time: ~7 min | Module 4 of 8

---

### Why ChromaDB

You have options: Pinecone, Weaviate, Qdrant, pgvector. For a first agent, ChromaDB is the right choice for one reason: it runs locally, stores to disk, and needs zero infrastructure.

```bash
pip install chromadb -q
```

That is the entire setup. Data persists between Python sessions. Shut down, reboot, come back tomorrow — the indexed incidents are still there.

---

### Create the Database

PersistentClient writes everything to disk. Three collections — one for each type of knowledge. get_or_create_collection is safe to run multiple times: it will not overwrite existing data.

```python
import chromadb

chroma_client = chromadb.PersistentClient(path="./agent_memory_db")

incidents_collection = chroma_client.get_or_create_collection(
    name="incidents",
    metadata={"hnsw:space": "cosine"}
)

protocols_collection = chroma_client.get_or_create_collection(
    name="protocols",
    metadata={"hnsw:space": "cosine"}
)

standards_collection = chroma_client.get_or_create_collection(
    name="standards",
    metadata={"hnsw:space": "cosine"}
)
```

We use cosine similarity as the distance metric. Cosine measures the angle between two vectors, not raw distance. For text, this is almost always the right choice — it handles different lengths gracefully.

---

### The index_incident() Function

Two things go into the embedding (what gets compared to new queries): the description + root_cause. That is the "symptom + explanation" pair. When a new incident comes in with similar symptoms, this is what ChromaDB compares against.

Everything else — resolution, device, protocol — goes in as metadata. Metadata comes back with search results but does not affect similarity scores.

```python
def index_incident(
    collection,
    incident_id: str,
    description: str,
    root_cause: str,
    resolution: str,
    device: str,
    protocol: str
):
    # This is the text ChromaDB embeds and compares against new queries
    document = f"{description}. Root cause: {root_cause}"

    collection.upsert(
        ids=[incident_id],
        documents=[document],
        metadatas=[{
            "resolution": resolution,
            "device":     device,
            "protocol":   protocol,
        }]
    )
    print(f"  Indexed: {incident_id} ({protocol.upper()})")
```

upsert = insert or update. Safe to run multiple times — no duplicates.

---

### Seed 4 Real MSP Incidents

These are based on real failure patterns. Notice the specificity — each description uses protocol-specific language and real symptom details. This specificity is what makes semantic search accurate.

```python
seed_incidents = [
    {
        "incident_id": "INC-2341",
        "description": "BGP neighbor down on CE router after scheduled maintenance window",
        "root_cause":  "Route-map CUSTOMER-OUT had a deny-all entry added during pre-change review that was never removed",
        "resolution":  "Removed deny statement from route-map CUSTOMER-OUT, soft-reset BGP session, prefixes propagated within 90 seconds",
        "device":      "Cisco ASR1001-X",
        "protocol":    "bgp",
    },
    {
        "incident_id": "INC-1955",
        "description": "OSPF adjacency not forming between core switches after VLAN reconfiguration",
        "root_cause":  "OSPF area mismatch — one interface was moved to area 1 during VLAN change, neighbor was still in area 0",
        "resolution":  "Corrected area assignment on affected interface, adjacency formed within 40 seconds",
        "device":      "Nexus 9300",
        "protocol":    "ospf",
    },
    {
        "incident_id": "INC-2107",
        "description": "IPSec tunnel between branch and HQ intermittently dropping large file transfers",
        "root_cause":  "MTU mismatch on ISP handoff — ISP reduced path MTU to 1476, tunnel was not adjusting MSS clamping",
        "resolution":  "Applied ip tcp adjust-mss 1436 on tunnel interface both sides, set ip mtu 1476 on outside interface",
        "device":      "Cisco ISR 4331",
        "protocol":    "ipsec",
    },
    {
        "incident_id": "INC-2288",
        "description": "OSPF neighbor stuck in EXSTART state after firmware upgrade",
        "root_cause":  "Duplex mismatch introduced after firmware upgrade reset interface defaults — one side auto-negotiated to half-duplex",
        "resolution":  "Hardcoded duplex full and speed 1000 on both sides, OSPF adjacency recovered immediately",
        "device":      "HP Aruba 2930F",
        "protocol":    "ospf",
    },
]

print("Indexing incidents...")
for inc in seed_incidents:
    index_incident(incidents_collection, **inc)

print(f"\nTotal documents: {incidents_collection.count()}")
```

Run this once. The data persists on disk — you do not need to re-run it.

---

Lesson 3 next: Querying ChromaDB and building the context block that goes into the LLM prompt.


---

Module 4 · Lesson 3 — Querying and the Context Block

Read time: ~8 min | Module 4 of 8

---

### What Is a Similarity Score?

Before writing any code, you need to understand what you will get back from ChromaDB — because it is not what you expect.

ChromaDB does not return a percentage or a ranking. It returns a cosine distance — a number between 0 and 2.

- 0 = identical (the two texts are pointing in the exact same direction in vector space)
- 2 = completely opposite (maximum possible difference in meaning)

That is not intuitive. So we convert it to a similarity score between 0.0 and 1.0:

  similarity = 1 - (distance / 2)

What the scores mean in practice:

  0.90 - 1.00  |  Near-identical incident       |  Yes — high confidence
  0.75 - 0.89  |  Same failure class            |  Yes
  0.65 - 0.74  |  Related, use with caution     |  Yes, with caveat
  Below 0.65   |  Probably not relevant         |  No — filter it out

One important caveat: the default ChromaDB embedding model (all-MiniLM) gives a baseline similarity of ~0.55 even for completely unrelated content. This means a score of 0.55 is not "55% similar" — it is essentially no match at all. Start your threshold at 0.65, not 0.5.

---

### What Is an Embedding, Actually?

When you call collection.upsert(documents=["BGP neighbor down..."]), ChromaDB passes that text through a small neural network (all-MiniLM-L6-v2) and produces a list of 384 numbers.

Those 384 numbers are coordinates. They represent the meaning of that sentence in a 384-dimensional space.

"BGP neighbor down after maintenance"        → [0.23, -0.41, 0.07, 0.88, ...]  (384 numbers)
"BGP session dropped after change window"    → [0.21, -0.39, 0.09, 0.85, ...]  (very close)
"Configure OSPF hello timer"                 → [0.71,  0.12, -0.44, -0.21, ...] (far away)

When you search, ChromaDB converts your query to 384 numbers and finds the stored vectors that are closest in that space. Closest = most similar meaning.

You do not need to understand the math. You need to understand: better text in = better matches out. Specific incident descriptions with real symptom language outperform generic text.

---

### find_similar_incidents()

```python
def find_similar_incidents(collection, query: str, n_results: int = 3) -> list:
    results = collection.query(
        query_texts=[query],
        n_results=n_results
    )

    incidents = []
    for i in range(len(results["ids"][0])):
        distance   = results["distances"][0][i]
        similarity = 1 - (distance / 2)   # convert to 0.0-1.0

        incidents.append({
            "id":         results["ids"][0][i],
            "document":   results["documents"][0][i],
            "metadata":   results["metadatas"][0][i],
            "similarity": round(similarity, 3),
        })

    return incidents
```

---

### The 0.65 Threshold Filter

Not every query will have a good match. If the agent retrieves a match with similarity 0.40 and presents it as relevant history, that is worse than no memory at all — it is fabricated context with a database behind it.

```python
SIMILARITY_THRESHOLD = 0.65
# Start here. Raise to 0.75 as your knowledge base grows.

def filter_relevant_incidents(incidents: list) -> list:
    return [inc for inc in incidents if inc["similarity"] >= SIMILARITY_THRESHOLD]
```

Test it with a query that has no good match:

```python
poor_query = "coffee machine broken in the office kitchen"
raw      = find_similar_incidents(incidents_collection, poor_query)
filtered = filter_relevant_incidents(raw)

# raw returns 3 results (ChromaDB always returns n_results)
# filtered returns 0 — similarity scores are all below 0.65
# This is correct behavior — the agent should not hallucinate network context
# from an unrelated query
```

---

### get_context_for_query() — The RAG Pipeline

This is the bridge between your memory layer and the LLM prompt. Retrieve -> filter -> format -> inject.

```python
def get_context_for_query(collection, query: str) -> str:
    raw_results = find_similar_incidents(collection, query, n_results=3)
    relevant    = filter_relevant_incidents(raw_results)

    if not relevant:
        return "No similar incidents found in knowledge base."

    context_lines = ["RELEVANT PAST INCIDENTS:"]
    for inc in relevant:
        meta = inc["metadata"]
        context_lines.append(
            f"\n[{inc['id']}] Similarity: {inc['similarity']}\n"
            f"Incident: {inc['document']}\n"
            f"Resolution: {meta['resolution']}\n"
            f"Device: {meta['device']} | Protocol: {meta['protocol']}"
        )

    return "\n".join(context_lines)


def build_agent_prompt(query: str, context: str) -> str:
    return f"""You are a network troubleshooting assistant for an MSP.

{context}

Current incident: {query}

Based on past incidents above (if relevant), provide a diagnosis and recommended resolution steps."""
```

The LLM sees past incidents first, then the current problem. This is the complete RAG pipeline — and it is the reason the agent says "similar to INC-2341" instead of giving you textbook troubleshooting.

---

### What NOT to Index

More data is not always better. Bad indexing degrades retrieval quality because irrelevant documents compete with relevant ones for similarity scores.

Index this (specific to YOUR environment):
+ Your client incidents with exact symptoms and device details
+ Firmware-specific bugs you have hit on real hardware
+ Your IP addressing scheme and device naming conventions
+ Your internal SOPs — the 6-step OSPF adjacency check your senior engineer wrote

Do NOT index:
- General networking theory — the LLM already has this from training
- Generic vendor config guides
- Anything that applies equally to every network on earth

The rule: if a junior engineer at a different MSP would also benefit from it, the LLM already knows it. If it is specific to your clients and history — that is what belongs in ChromaDB.

---

Module Challenge: Index 3 real incidents from your ticketing system. Then run a query with a slightly different description of the same problem (the way a different engineer might write it). Post your similarity score in #agent-builds.


---

Module 4 · Lesson 4 — Advanced RAG Patterns

Read time: ~8 min | Module 4 of 8 — Memory and RAG

---

### Where Basic ChromaDB Breaks Down

The setup from Lessons 2 and 3 works well for a single client with a few hundred incidents. At 30 clients and 5,000 incidents, three problems appear:

1. A query for "OSPF on client-rtr-01" returns incidents from other clients' routers
2. Semantic search finds incidents that are textually similar but operationally irrelevant
3. The same query from different engineers returns inconsistent results because the phrasing varies

None of these are ChromaDB bugs. They are design gaps in how you store and query. This lesson closes them.

---

### Pattern 1: Metadata Filtering

Right now your incidents are stored with embeddings and text. You probably have some metadata:

```python
kb.add(
    documents=["OSPF area mismatch on client-rtr-01..."],
    metadatas=[{"device": "client-rtr-01", "type": "incident_diagnosis"}],
    ids=["INC-1955"]
)
```

You query without using that metadata:

```python
results = kb.query(query_texts=["ospf neighbor down"], n_results=5)
```

This searches all 5,000 incidents for semantic similarity. You get the 5 most similar incidents from anywhere across your entire client base.

The fix: filter before you embed.

```python
def search_kb_for_client(query: str, client_id: str, protocol: str = None,
                          n_results: int = 5) -> list[dict]:
    where_filter = {"client_id": {"$eq": client_id}}

    if protocol:
        where_filter = {
            "$and": [
                {"client_id": {"$eq": client_id}},
                {"protocol":  {"$eq": protocol}}
            ]
        }

    results = kb.query(
        query_texts=[query],
        n_results=n_results,
        where=where_filter   # filter FIRST, then rank by similarity
    )
    return _format_results(results)
```

Now "OSPF neighbor down" only searches incidents tagged with `client_id="acme-corp"` and `protocol="ospf"`. The similarity ranking runs against 80 incidents instead of 5,000. Faster. More relevant. No cross-client data leakage.

**Add these metadata fields when indexing incidents:**

```python
def index_incident(incident: dict):
    kb.add(
        documents=[incident["summary"]],
        metadatas=[{
            "client_id":   incident["client_id"],
            "device":      incident["device"],
            "protocol":    incident["protocol"],        # ospf, bgp, ipsec, vlan
            "issue_type":  incident["issue_type"],      # adjacency, route, auth, mtu
            "resolved":    str(incident["resolved"]),   # "true" / "false"
            "severity":    incident["severity"],        # p1, p2, p3
            "timestamp":   incident["timestamp"],       # ISO 8601
        }],
        ids=[incident["ticket_id"]]
    )
```

Metadata fields cost almost nothing to store. Add them aggressively. You will thank yourself when you need to filter.

---

### Pattern 2: Hybrid Search (Semantic + Keyword)

Semantic search finds conceptually related incidents. Keyword search finds exact matches. Both have failure modes.

Semantic search failure: "OSPF INIT state" matches "BGP IDLE state" at 0.82 similarity because both describe a neighbor stuck in a non-operational state. Semantically similar. Operationally different protocol.

Keyword search failure: "neighbor 3.3.3.3 down" misses "adjacency with 3.3.3.3 not forming" because the words differ even though the meaning is identical.

Hybrid search runs both and combines the results:

```python
import re

def hybrid_search(query: str, client_id: str, n_results: int = 5) -> list[dict]:
    # Semantic search
    semantic_hits = kb.query(
        query_texts=[query],
        n_results=n_results * 2,
        where={"client_id": {"$eq": client_id}}
    )

    # Keyword search — extract IP addresses, device names, protocol keywords
    keywords = _extract_network_entities(query)
    keyword_hits = []
    if keywords:
        keyword_hits = kb.query(
            query_texts=[" ".join(keywords)],
            n_results=n_results * 2,
            where={"client_id": {"$eq": client_id}}
        )

    # Merge and deduplicate by ticket ID
    seen = set()
    merged = []
    for result_set in [semantic_hits, keyword_hits]:
        for i, doc_id in enumerate(result_set["ids"][0]):
            if doc_id not in seen:
                seen.add(doc_id)
                merged.append({
                    "id":       doc_id,
                    "text":     result_set["documents"][0][i],
                    "distance": result_set["distances"][0][i],
                    "metadata": result_set["metadatas"][0][i],
                })

    # Sort by similarity score
    merged.sort(key=lambda x: x["distance"])
    return merged[:n_results]


def _extract_network_entities(text: str) -> list[str]:
    """Pull out IP addresses, hostnames, and protocol names."""
    patterns = [
        r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b',   # IP addresses
        r'\b[A-Za-z]+-[A-Za-z]+-\d+\b',                # hostnames like client-rtr-01
        r'\b(ospf|bgp|eigrp|isis|ipsec|vlan|stp)\b',   # protocol keywords
    ]
    entities = []
    for pattern in patterns:
        entities.extend(re.findall(pattern, text, re.IGNORECASE))
    return list(set(entities))
```

In practice, hybrid search reduces missed recalls by 30-40% on network-specific queries where IP addresses and device names are the most important search signal — things semantic search is weakest on.

---

### Pattern 3: Query Reformulation

Your agent sends a raw query to ChromaDB: `"ospf neighbor 3.3.3.3 client-rtr-01 INIT state"`. That is exactly what the incident report in the KB says, more or less. It will find good matches.

But sometimes the agent is working from partial information. It knows the symptom but not the cause yet. Its query is: `"branch office users cannot reach data centre"`. That is a user-facing symptom. The KB stores technical diagnoses. The mismatch means poor recall.

Query reformulation: have the LLM translate the symptom into a technical search query before hitting ChromaDB.

```python
REFORMULATE_PROMPT = """
You are a search query optimizer for a network incident knowledge base.

The knowledge base contains technical network incident records indexed by:
- Protocol (ospf, bgp, ipsec, vlan, stp)
- Device names and IP addresses
- Root cause descriptions (timer mismatch, area mismatch, MTU mismatch, etc.)
- Symptom descriptions

Translate the following natural language query into 2-3 specific technical search queries
that will retrieve the most relevant past incidents.

Input query: {query}

Return a JSON array of search query strings. No explanation.
Example: ["ospf neighbor INIT timer mismatch", "hello dead timer ospf adjacency"]
"""

def reformulate_query(raw_query: str) -> list[str]:
    prompt = REFORMULATE_PROMPT.format(query=raw_query)
    result = llm.invoke(prompt).content
    try:
        queries = json.loads(result)
        return queries if isinstance(queries, list) else [raw_query]
    except json.JSONDecodeError:
        return [raw_query]   # fall back to original query


def search_with_reformulation(raw_query: str, client_id: str) -> list[dict]:
    queries = reformulate_query(raw_query)
    all_results = []
    seen_ids = set()

    for q in queries:
        hits = hybrid_search(q, client_id, n_results=3)
        for hit in hits:
            if hit["id"] not in seen_ids:
                seen_ids.add(hit["id"])
                all_results.append(hit)

    all_results.sort(key=lambda x: x["distance"])
    return all_results[:5]
```

Use reformulation when: the agent is in the OBSERVE node and the incident description comes from a ticket (user-facing language) rather than from a show command (technical language).

---

### Pattern 4: Time-Weighted Relevance

A KB hit from 3 years ago that matches well is less useful than a hit from 6 weeks ago that matches moderately well. Networks change. Vendor firmware changes. Client configs change. Old incidents can point at the wrong fix.

Weight recent incidents higher:

```python
from datetime import datetime, timezone

def time_weight(timestamp_str: str, half_life_days: int = 90) -> float:
    """Returns 1.0 for today's incidents, decays toward 0 over time."""
    try:
        ts = datetime.fromisoformat(timestamp_str).replace(tzinfo=timezone.utc)
        age_days = (datetime.now(timezone.utc) - ts).days
        return 0.5 ** (age_days / half_life_days)
    except Exception:
        return 0.5   # unknown age: neutral weight


def rank_with_time_weight(results: list[dict]) -> list[dict]:
    for r in results:
        similarity  = 1 - r["distance"]   # convert distance to similarity
        recency     = time_weight(r["metadata"].get("timestamp", ""))
        r["score"]  = 0.7 * similarity + 0.3 * recency
    results.sort(key=lambda x: x["score"], reverse=True)
    return results
```

The 0.7 / 0.3 split is a starting point. Adjust based on how frequently your client networks change. A client with weekly firmware updates: shift toward 0.8 / 0.2. A stable enterprise network that changes rarely: 0.6 / 0.4 is fine.

---

### Putting It Together in the OBSERVE Node

Replace the basic `search_kb()` call with the full pipeline:

```python
def observe(state: OSPFAgentState) -> dict:
    raw_query = (
        f"ospf neighbor {state['neighbor_ip']} on {state['device']} "
        f"stuck in {state['neighbor_state']}"
    )

    kb_hits = search_with_reformulation(
        raw_query=raw_query,
        client_id=state["client_id"]
    )
    kb_hits = rank_with_time_weight(kb_hits)

    # rest of observe node unchanged
    ...
```

Three lines changed. Memory quality improves substantially — especially as your KB grows past a few hundred incidents.

---

### What Not to Index

This is as important as what to index.

**Do not index:**
- Raw show command output (too verbose, too specific to a moment in time)
- Full running configs (changes constantly, creates staleness problems)
- Ticket comments from clients (user-facing language, low signal)
- Incidents marked as "not reproduced" or "user error"

**Index only:**
- Confirmed root cause + resolution from closed tickets
- KB articles with validated fixes
- Known issue patterns with confidence level

The quality of your RAG output is bounded by the quality of what you put in. 500 high-quality confirmed incident resolutions will outperform 5,000 noisy ticket comments every time.

---

Module Challenge: Add `client_id` and `protocol` metadata to your existing ChromaDB incident records. Run a query with the metadata filter applied. Compare the results to the unfiltered query. Post in #agent-builds: how many of your top-5 results changed after adding the filter?

Community: skool.com/autonomous-msp-2162
