# Module 6: The Context Layer
### MCP Standards Server + Network Topology Graph

**Duration:** 1 hour
**What you build:** `context/` folder — a live standards API server and Neo4j topology queries.

---

## 6.1 Why Context Matters

Without context, your agent knows networking in general but not YOUR network.

It doesn't know:
- "We use OSPF process 1, not process 100"
- "There's a change freeze right now"
- "rtr-01 is connected to rtr-02 via two redundant links"
- "If rtr-01 fails, 14 services are affected"

Context grounds the agent in your actual environment. It's the difference between generic AI advice and targeted, accurate recommendations.

The Context Layer has two parts:
1. **MCP Server** — Live standards and current operational state
2. **Knowledge Graph** — Your network topology as a queryable graph

---

## 6.2 The MCP Standards Server

MCP (Model Context Protocol) is a simple pattern: a local API server that the agent queries to get current standards and state. You maintain this — it's your single source of truth.

Create `my-network-agent/context/mcp_server.py`:

```python
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional
import uvicorn
import datetime

app = FastAPI(title="Network Agent MCP Server", version="1.0")

# ─────────────────────────────────────────────────────────────
# Organisational Standards (update these to match your network)
# ─────────────────────────────────────────────────────────────

STANDARDS = {
    "routing": {
        "primary_protocol": "OSPF",
        "ospf_process_id": 1,
        "backbone_area": "0.0.0.0",
        "site_area_mapping": {
            "datacenter-1": "0.0.0.0",
            "datacenter-2": "0.0.0.1",
            "branch-sites": "0.0.0.2",
        },
        "bgp_used_for": ["WAN", "datacenter_interconnect"],
        "prohibited_protocols": ["EIGRP", "RIPv2"],
    },
    "naming": {
        "convention": "{site_code}-{role}-{sequence_number}",
        "examples": ["dc1-core-01", "dc1-dist-01", "br1-acc-01"],
        "roles": ["core", "dist", "acc", "fw", "lb"],
    },
    "security": {
        "management_access": "SSH only (SSHv2)",
        "snmp_version": "v3 only",
        "authentication": "TACACS+ primary, local fallback",
        "password_policy": "min 12 chars, complexity required",
    },
    "interfaces": {
        "default_mtu": 1500,
        "core_link_mtu": 9000,
        "ospf_hello_interval": 10,
        "ospf_dead_interval": 40,
        "duplex": "auto (access), full (core)",
    },
}


class ChangeWindowState(BaseModel):
    is_frozen: bool
    frozen_until: Optional[str]
    reason: Optional[str]


def get_change_window_state() -> ChangeWindowState:
    """Check if we are currently in a change freeze."""
    now = datetime.datetime.now()
    # Example: freeze from Dec 15 to Jan 10
    in_freeze = (now.month == 12 and now.day >= 15) or (now.month == 1 and now.day <= 10)
    if in_freeze:
        return ChangeWindowState(
            is_frozen=True,
            frozen_until="January 10",
            reason="Annual holiday change freeze",
        )
    return ChangeWindowState(is_frozen=False, frozen_until=None, reason=None)


# ─────────────────────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────────────────────

@app.get("/mcp/standards")
def get_standards():
    """Return all organisational network standards."""
    return STANDARDS


@app.get("/mcp/standards/routing")
def get_routing_standards():
    return STANDARDS["routing"]


@app.get("/mcp/state/change-window")
def get_change_window():
    """Is there a change freeze active right now?"""
    return get_change_window_state()


@app.get("/mcp/standards/validate-config")
def validate_config(ospf_process: int = None, area: str = None, protocol: str = None):
    """
    Validate a configuration against standards.
    Returns compliance status.
    """
    issues = []

    if ospf_process and ospf_process != STANDARDS["routing"]["ospf_process_id"]:
        issues.append(f"OSPF process ID should be {STANDARDS['routing']['ospf_process_id']}, not {ospf_process}")

    if protocol and protocol.upper() in STANDARDS["routing"]["prohibited_protocols"]:
        issues.append(f"{protocol} is prohibited. Use {STANDARDS['routing']['primary_protocol']}")

    if issues:
        return {"compliant": False, "issues": issues}
    return {"compliant": True, "issues": []}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
```

Run the server:
```bash
python context/mcp_server.py
# Server starts at http://localhost:8080
# View API docs at http://localhost:8080/docs
```

---

## 6.3 Query MCP From the Agent

Create `my-network-agent/context/mcp_client.py`:

```python
import requests
from typing import dict


MCP_BASE_URL = "http://localhost:8080"
DEMO_MODE = True  # Set to False when MCP server is running

DEMO_STANDARDS = {
    "routing": {
        "primary_protocol": "OSPF",
        "ospf_process_id": 1,
        "backbone_area": "0.0.0.0",
    },
    "change_freeze": False,
}


def get_standards() -> dict:
    if DEMO_MODE:
        return DEMO_STANDARDS

    try:
        response = requests.get(f"{MCP_BASE_URL}/mcp/standards", timeout=5)
        return response.json()
    except Exception:
        return DEMO_STANDARDS  # fallback to defaults if MCP server is down


def is_change_freeze_active() -> bool:
    if DEMO_MODE:
        return DEMO_STANDARDS["change_freeze"]

    try:
        response = requests.get(f"{MCP_BASE_URL}/mcp/state/change-window", timeout=5)
        return response.json()["is_frozen"]
    except Exception:
        return False


def get_mcp_context_for_prompt() -> str:
    """Format MCP data for injection into the agent prompt."""
    standards = get_standards()
    frozen = is_change_freeze_active()

    routing = standards.get("routing", {})
    lines = [
        "NETWORK STANDARDS (from MCP server):",
        f"  Routing protocol: {routing.get('primary_protocol', 'OSPF')}",
        f"  OSPF process ID: {routing.get('ospf_process_id', 1)}",
        f"  Backbone area: {routing.get('backbone_area', '0.0.0.0')}",
    ]

    if frozen:
        lines.append("  !! CHANGE FREEZE IS ACTIVE — do not propose or apply any changes !!")

    return "\n".join(lines)
```

---

## 6.4 The Knowledge Graph (Neo4j)

A knowledge graph models your network as nodes and relationships. This lets the agent answer questions like:
- "What devices are connected to rtr-01?"
- "If rtr-01 fails, what services are affected?"
- "What is the path from the firewall to the web server?"

**Install Neo4j (easiest way — Docker):**
```bash
docker run -d \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:5
# Access at http://localhost:7474 (user: neo4j, password: password)
```

Create `my-network-agent/context/graph_store.py`:

```python
import os
from typing import List, Optional

DEMO_MODE = True  # Set to False when Neo4j is running

# Demo topology data (simulates what would be in Neo4j)
DEMO_TOPOLOGY = {
    "devices": {
        "rtr-01": {"role": "core-router", "site": "dc1", "ip": "192.168.1.1"},
        "rtr-02": {"role": "distribution-router", "site": "dc1", "ip": "192.168.1.2"},
        "rtr-03": {"role": "branch-router", "site": "branch-1", "ip": "10.0.0.1"},
        "fw-01": {"role": "firewall", "site": "dc1", "ip": "192.168.1.254"},
    },
    "connections": [
        {"from": "rtr-01", "to": "rtr-02", "interface_a": "Gi0/0", "interface_b": "Gi0/0", "type": "core-link"},
        {"from": "rtr-01", "to": "rtr-03", "interface_a": "Gi0/1", "interface_b": "Gi0/0", "type": "wan-link"},
        {"from": "fw-01", "to": "rtr-01", "interface_a": "Gi0/0", "interface_b": "Gi0/2", "type": "security-link"},
    ],
    "services": {
        "web-portal": {"host": "rtr-02", "ip": "192.168.10.100", "critical": True},
        "erp-system": {"host": "rtr-02", "ip": "192.168.10.200", "critical": True},
        "monitoring": {"host": "rtr-01", "ip": "192.168.1.50", "critical": False},
    },
}


class NetworkGraphStore:
    """Query network topology from Neo4j (or demo data)."""

    def __init__(self):
        if not DEMO_MODE:
            from neo4j import GraphDatabase
            uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
            user = os.environ.get("NEO4J_USER", "neo4j")
            password = os.environ.get("NEO4J_PASSWORD", "password")
            self.driver = GraphDatabase.driver(uri, auth=(user, password))

    def get_device_neighbors(self, device_name: str) -> List[dict]:
        """What devices is this device directly connected to?"""
        if DEMO_MODE:
            neighbors = []
            for conn in DEMO_TOPOLOGY["connections"]:
                if conn["from"] == device_name:
                    neighbors.append({
                        "neighbor": conn["to"],
                        "local_interface": conn["interface_a"],
                        "remote_interface": conn["interface_b"],
                        "link_type": conn["type"],
                    })
                elif conn["to"] == device_name:
                    neighbors.append({
                        "neighbor": conn["from"],
                        "local_interface": conn["interface_b"],
                        "remote_interface": conn["interface_a"],
                        "link_type": conn["type"],
                    })
            return neighbors

        # Real Neo4j query
        with self.driver.session() as session:
            result = session.run("""
                MATCH (d:Device {name: $name})-[r:CONNECTED_TO]-(n:Device)
                RETURN n.name as neighbor, r.local_interface, r.remote_interface
            """, name=device_name)
            return [dict(record) for record in result]

    def get_blast_radius(self, device_name: str) -> dict:
        """If this device fails, what is affected?"""
        if DEMO_MODE:
            affected_services = []
            affected_devices = []

            for conn in DEMO_TOPOLOGY["connections"]:
                if conn["from"] == device_name or conn["to"] == device_name:
                    other = conn["to"] if conn["from"] == device_name else conn["from"]
                    affected_devices.append(other)

            for svc_name, svc in DEMO_TOPOLOGY["services"].items():
                if svc["host"] in affected_devices or svc["host"] == device_name:
                    affected_services.append({
                        "service": svc_name,
                        "ip": svc["ip"],
                        "critical": svc["critical"],
                    })

            return {
                "failed_device": device_name,
                "directly_affected_devices": affected_devices,
                "affected_services": affected_services,
                "critical_services_affected": [s for s in affected_services if s["critical"]],
            }

        # Real Neo4j query
        with self.driver.session() as session:
            result = session.run("""
                MATCH (failed:Device {name: $name})
                MATCH (svc:Service)-[:HOSTED_ON*1..3]->(d:Device)-[:CONNECTED_TO*0..3]-(failed)
                RETURN DISTINCT svc.name, svc.ip, svc.critical
            """, name=device_name)
            return {"affected_services": [dict(r) for r in result]}

    def get_topology_context(self, device_name: str) -> str:
        """Format topology info for the agent prompt."""
        neighbors = self.get_device_neighbors(device_name)
        blast = self.get_blast_radius(device_name)

        lines = [f"TOPOLOGY CONTEXT for {device_name}:"]

        if neighbors:
            lines.append("  Directly connected to:")
            for n in neighbors:
                lines.append(f"    - {n['neighbor']} via {n['local_interface']} <-> {n['remote_interface']}")
        else:
            lines.append("  No topology data found for this device.")

        if blast["critical_services_affected"]:
            lines.append("  CRITICAL services that depend on this device:")
            for svc in blast["critical_services_affected"]:
                lines.append(f"    - {svc['service']} ({svc['ip']})")

        return "\n".join(lines)
```

---

## 6.5 Populate the Knowledge Graph

For a real deployment, run this once to load your inventory:

```python
# context/populate_graph.py
from neo4j import GraphDatabase

driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "password"))

CYPHER_SCHEMA = """
// Create device nodes
MERGE (:Device {name: 'rtr-01', role: 'core-router', site: 'dc1'})
MERGE (:Device {name: 'rtr-02', role: 'dist-router', site: 'dc1'})
MERGE (:Device {name: 'fw-01',  role: 'firewall',    site: 'dc1'})

// Create connections
MATCH (a:Device {name: 'rtr-01'}), (b:Device {name: 'rtr-02'})
MERGE (a)-[:CONNECTED_TO {local_interface: 'Gi0/0', remote_interface: 'Gi0/0', ospf_area: '0'}]->(b)

MATCH (a:Device {name: 'fw-01'}), (b:Device {name: 'rtr-01'})
MERGE (a)-[:CONNECTED_TO {local_interface: 'Gi0/0', remote_interface: 'Gi0/2', type: 'security'}]->(b)

// Create services
MERGE (:Service {name: 'web-portal', ip: '192.168.10.100', critical: true})
MATCH (s:Service {name: 'web-portal'}), (d:Device {name: 'rtr-02'})
MERGE (s)-[:HOSTED_ON]->(d)
"""

with driver.session() as session:
    for statement in CYPHER_SCHEMA.strip().split("\n\n"):
        if statement.strip():
            session.run(statement)

print("Graph populated.")
```

---

## 6.6 Wire Context Into the Agent

In `agent.py`, update `observe_node` to also query topology and MCP:

```python
from context.mcp_client import get_mcp_context_for_prompt
from context.graph_store import NetworkGraphStore

graph_store = NetworkGraphStore()

def observe_node(state: AgentState) -> AgentState:
    # ... existing RAG query ...

    # Add MCP standards context
    mcp_context = get_mcp_context_for_prompt()

    # Extract device name from query if possible (simple heuristic)
    device_mentioned = None
    for word in state["user_query"].split():
        if word.startswith("rtr-") or word.startswith("fw-") or word.startswith("sw-"):
            device_mentioned = word.rstrip(".,:")
            break

    # Add topology context
    topo_context = ""
    if device_mentioned:
        topo_context = graph_store.get_topology_context(device_mentioned)

    full_context = "\n\n".join(filter(None, [rag_context, mcp_context, topo_context]))

    return {
        **state,
        "rag_context": full_context,
        # ... rest of observe_node return ...
    }
```

---

## Lab 6.1: Add a Blast Radius Tool

Create a new READ tool called `get_blast_radius` that uses `NetworkGraphStore.get_blast_radius()`:

```python
class BlastRadiusTool(BaseTool):
    name = "get_blast_radius"
    description = "Determine what devices and services would be affected if a device fails"
    category = ToolCategory.READ
    parameters = [
        ParameterDef("device", "string", "Device to analyse blast radius for", required=True),
    ]

    def execute(self, device: str) -> ToolResult:
        # Your implementation here
        pass
```

Test: ask the agent "What happens to services if rtr-01 fails?" — it should use this tool.

---

## Module 6 Quiz

1. What is the difference between what MCP provides and what RAG provides?
2. The MCP server says "change freeze is active." What should the agent do differently?
3. If Neo4j is unavailable, the `NetworkGraphStore` falls back to demo data. Is this safe in production? Why or why not?
4. Why is a graph database better than a relational database for network topology?
5. You want the agent to know "rtr-01 is in the critical path for 14 services." Should this go in the knowledge graph or RAG? Why?

---

## What's Next

Your agent is now intelligent and aware of your environment. The final two modules cover production safety and observability, then the capstone where you wire everything together.

**Module 7: Production, Safety and Observability ->**


---

Module 6 · Lesson 1 — MCP: Your Standards Server

Read time: ~7 min | Module 6 of 8

---

### The Problem Without Context

Your agent from Module 5 knows networking theory. It does not know YOUR network.

Run this in your head. A client's BGP session to the upstream ISP is flapping. The agent fires up and starts reasoning. It has no idea whether this client runs OSPF or EIGRP. Without context, it might generate a recommendation that references EIGRP — because the symptom matched something in training. Your client runs OSPF everywhere.

Or worse: the agent suggests a config change at 11:30 PM Friday. There is a change freeze until Monday morning. Nobody told the agent.

MCP — Model Context Protocol — fixes this. You build a small server that knows your standards. The agent calls it before every reasoning step.

---

### The MSP Angle

You have 50 clients. Each one has different standards. Client A runs OSPF process 1, area 0. Client B runs BGP only, AS 65001. Client C is a government account with no changes without a ticket number.

One agent. Fifty context profiles.

You deploy one MCP server per client — or one server with per-client namespacing. The agent receives its client ID at the start of a session, fetches the right context, and operates within that client's rules for the entire session. You never have to re-explain the environment.

---

### Build mcp_server.py

```python
from fastapi import FastAPI
from datetime import datetime

app = FastAPI()

CLIENT_STANDARDS = {
    "client-acme": {
        "routing_protocol":  "OSPF",
        "ospf_process_id":   1,
        "ospf_area":         "0.0.0.0",
        "naming_convention": "SITE-ROLE-SEQ (e.g. NYC-RTR-01)",
        "no_protocols":      ["EIGRP", "RIP", "IS-IS"],
        "mgmt_vlan":         99,
    },
}

CHANGE_FREEZE = {
    "client-acme": {
        "frozen":       False,
        "reason":       None,
        "freeze_until": None,
    },
}


@app.get("/mcp/standards/{client_id}")
def get_standards(client_id: str):
    standards = CLIENT_STANDARDS.get(client_id)
    if not standards:
        return {"error": f"No standards profile for: {client_id}"}
    return {"client_id": client_id, "standards": standards,
            "fetched_at": datetime.utcnow().isoformat()}


@app.get("/mcp/state/change-window/{client_id}")
def get_change_window(client_id: str):
    state = CHANGE_FREEZE.get(client_id, {"frozen": False, "reason": None})
    return {"client_id": client_id, "frozen": state["frozen"],
            "reason": state.get("reason"),
            "checked_at": datetime.utcnow().isoformat()}
```

Run it:

```bash
uvicorn mcp_server:app --host 0.0.0.0 --port 8001 --reload
```

---

### Build mcp_client.py

The agent does not call HTTP directly. A clean wrapper.

```python
import requests

MCP_BASE_URL = "http://localhost:8001"


def get_mcp_context_for_prompt(client_id: str) -> str:
    """Build a context block ready to inject into the system prompt."""
    try:
        standards_resp = requests.get(
            f"{MCP_BASE_URL}/mcp/standards/{client_id}", timeout=3
        ).json()
        freeze_resp = requests.get(
            f"{MCP_BASE_URL}/mcp/state/change-window/{client_id}", timeout=3
        ).json()
    except requests.RequestException:
        return "=== MCP UNREACHABLE — defaulting to change freeze active ==="

    standards = standards_resp.get("standards", {})
    frozen    = freeze_resp.get("frozen", True)   # fail safe: frozen if unreachable

    lines = ["=== CLIENT STANDARDS ==="]
    for key, value in standards.items():
        lines.append(f"  {key}: {value}")

    lines.append("\n=== CHANGE WINDOW STATUS ===")
    if frozen:
        lines.append("  STATUS: CHANGE FREEZE ACTIVE")
        lines.append("  ACTION: Do NOT propose any configuration changes.")
    else:
        lines.append("  STATUS: Changes permitted")

    return "\n".join(lines)
```

Critical line: frozen = True if the MCP server is unreachable. Fail safe. If your standards server is down, the agent does not guess — it defaults to frozen. That is the right behavior on client infrastructure.

Test it:

```python
from mcp_client import get_mcp_context_for_prompt
print(get_mcp_context_for_prompt("client-acme"))
```

If you see your standards printed cleanly, the plumbing works.

---

Module Challenge: Add one real standard from your actual environment to CLIENT_STANDARDS. Your OSPF process ID, your device naming convention, your change freeze schedule — pick one. Run the server, call get_mcp_context_for_prompt(), verify it appears. Post your output in #agent-builds (redact client names and IPs).


---

Module 6 · Lesson 2 — Network Topology as a Graph

Read time: ~7 min | Module 6 of 8

---

### Why Graph — Not SQL, Not JSON

You could store topology in a flat JSON file: {"rtr-01": ["sw-01", "sw-02"]}. That works until someone asks: "If rtr-01 goes down, which services are unreachable?"

To answer that from a flat file you write a recursive traversal. Then you handle cycles. Then you handle directional paths. Then you realize you just built a graph database by hand, badly.

Networks are graphs. Devices are nodes. Connections are edges. Graph databases are built to answer graph questions in one query.

With a topology graph your agent can answer:
- "What is directly connected to rtr-01?" — one-hop neighbor query
- "What services are hosted behind sw-03?" — traversal query
- "If fw-01 fails, what is the blast radius?" — reachability from failure point

---

### The NetworkGraphStore Class

No Neo4j needed to start — a demo dict handles the first run. Flip DEMO_MODE = False when you have Docker available.

```python
DEMO_TOPOLOGY = {
    "fw-01":  {"neighbors": ["rtr-01"], "services": []},
    "rtr-01": {"neighbors": ["fw-01", "sw-01"], "services": []},
    "sw-01":  {"neighbors": ["rtr-01"], "services": ["web-app", "db-backup"]},
}

DEMO_MODE = True   # flip to False for real Neo4j


class NetworkGraphStore:
    def get_device_neighbors(self, device_name: str) -> list:
        """Return all devices directly connected to this device."""
        if DEMO_MODE:
            return DEMO_TOPOLOGY.get(device_name, {}).get("neighbors", [])

        with self.driver.session() as s:
            result = s.run("""
                MATCH (d:Device {name: $name})-[:CONNECTED_TO]-(n:Device)
                RETURN n.name AS name
            """, name=device_name)
            return [r["name"] for r in result]

    def get_blast_radius(self, device_name: str) -> dict:
        """What breaks if this device fails?"""
        if DEMO_MODE:
            affected_devices, affected_services = [], []
            visited = set()

            def traverse(node):
                if node in visited:
                    return
                visited.add(node)
                entry = DEMO_TOPOLOGY.get(node, {})
                for n in entry.get("neighbors", []):
                    if n != device_name:
                        affected_devices.append(n)
                        traverse(n)
                affected_services.extend(entry.get("services", []))

            traverse(device_name)
            return {
                "failed_device":     device_name,
                "affected_devices":  list(set(affected_devices)),
                "affected_services": list(set(affected_services)),
            }

        with self.driver.session() as s:
            result = s.run("""
                MATCH (f:Device {name: $name})-[:CONNECTED_TO*1..5]-(a:Device)
                OPTIONAL MATCH (a)-[:HOSTS]->(svc:Service)
                RETURN collect(DISTINCT a.name)   AS affected_devices,
                       collect(DISTINCT svc.name) AS affected_services
            """, name=device_name)
            row = result.single()
            return {
                "failed_device":     device_name,
                "affected_devices":  row["affected_devices"] if row else [],
                "affected_services": [s for s in row["affected_services"] if s] if row else [],
            }

    def get_topology_context(self, device_name: str) -> str:
        """Formatted text block, ready to inject into a prompt."""
        neighbors = self.get_device_neighbors(device_name)
        blast     = self.get_blast_radius(device_name)

        lines = [f"=== TOPOLOGY CONTEXT: {device_name} ==="]
        lines.append(f"  Direct neighbors: {', '.join(neighbors) or 'none found'}")
        lines.append(f"  Blast radius (devices): {', '.join(blast['affected_devices']) or 'isolated'}")
        lines.append(f"  Blast radius (services): {', '.join(blast['affected_services']) or 'none'}")
        return "\n".join(lines)
```

Test with demo mode:

```python
store = NetworkGraphStore()
print(store.get_topology_context("rtr-01"))
# Direct neighbors: fw-01, sw-01
# Blast radius (devices): sw-01
# Blast radius (services): web-app, db-backup
```

---

Lesson 3 next: Wire all three context sources (RAG + MCP + topology) into observe_node.


---

Module 6 · Lesson 3 — Wire Context Into observe_node

Read time: ~5 min | Module 6 of 8

---

### Three Context Sources, One Block

In Module 5, observe_node fetched RAG context from ChromaDB. Now it pulls three sources: RAG, MCP standards, and topology. The agent does not change. The tools do not change. Only the context payload grows richer.

```python
from mcp_client  import get_mcp_context_for_prompt
from graph_store import NetworkGraphStore
import re

graph_store      = NetworkGraphStore()
ACTIVE_CLIENT_ID = "client-acme"   # in production, pass per session


def extract_device_name(query: str) -> str | None:
    """Find a device-name-shaped token in the query."""
    pattern = r'\b([a-z]{2,6}-)?([a-z]{2,6}-\d{2}(?:\.[a-z0-9.-]+)?)\b'
    match = re.search(pattern, query.lower())
    return match.group(0) if match else None


def observe_node(state: AgentState) -> dict:
    query = state["user_query"]

    # 1. RAG — ChromaDB (Module 4)
    rag_results = chroma_collection.query(query_texts=[query], n_results=5)
    rag_text    = "\n".join(rag_results["documents"][0])

    # 2. MCP — client standards + change freeze
    mcp_context = get_mcp_context_for_prompt(ACTIVE_CLIENT_ID)

    # 3. Topology — blast radius for the device in the query
    device_name  = extract_device_name(query)
    topo_context = (
        graph_store.get_topology_context(device_name)
        if device_name
        else "No specific device identified in query."
    )

    combined_context = "\n\n".join([
        "=== RAG KNOWLEDGE BASE ===",
        rag_text or "  No relevant documents found.",
        mcp_context,
        topo_context,
    ])

    return {"rag_context": combined_context, "evidence": [], "iteration": 0}
```

Before the agent reasons, it now knows: relevant past incidents, this client's routing standards and change window status, and which devices would be affected if the queried device fails.

---

### The BlastRadiusTool

The agent can also call blast radius as an explicit tool during the reasoning loop:

```python
class BlastRadiusTool(BaseTool):
    name        = "blast_radius_check"
    description = (
        "Query the topology graph to find which devices and services will be "
        "impacted if the specified device fails. "
        "Use this before any restart or maintenance operation."
    )
    category    = READ
    parameters  = {"device_name": "device hostname to check"}

    def execute(self, device_name: str) -> ToolResult:
        result = graph_store.get_blast_radius(device_name)
        if not result["affected_devices"] and not result["affected_services"]:
            return ToolResult(
                success=True,
                data={"summary": f"{device_name}: isolated — no downstream impact"}
            )
        summary = (
            f"Blast radius for {device_name}:\n"
            f"  Affected devices:  {', '.join(result['affected_devices'])}\n"
            f"  Affected services: {', '.join(result['affected_services'])}\n"
            f"  Notify stakeholders before taking this device offline."
        )
        return ToolResult(success=True, data={"summary": summary})
```

An operator types: "I need to restart rtr-01 to apply the new OSPF config."

The agent now does three things automatically: checks the change window (MCP), checks the blast radius (graph), checks past restart incidents (ChromaDB). The response: "Change window is open. Restarting rtr-01 will affect sw-01 and interrupt web-app. Recommend coordinating with the application team before proceeding."

That is the answer a senior engineer gives. Your agent gives it automatically, on the first call.
