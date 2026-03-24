# Module 3: The Tool Layer
### Build the Agent's Hands — SSH, APIs, and the Safety Gate

**Duration:** 1.5 hours
**What you build:** `tools/` folder with real SSH tools, a NetBox integration, and the approval gate that protects your network.

---

## 3.1 Tool Design Principles

Before writing a single line, understand these three rules:

**Rule 1: Tools are the only way the agent touches your network.**
The LLM cannot SSH anywhere. It cannot call an API. It can only ask a tool to do it. You control what tools exist — so you control what the agent can and cannot do.

**Rule 2: Every tool must have a category.**
- `READ` — runs show commands, reads configs, queries APIs. Safe to auto-execute.
- `WRITE` — pushes configs, modifies state. Requires your approval.
- `ADMIN` — reloads, factory resets. Requires explicit typed confirmation.

**Rule 3: Tools must return structured data, not raw CLI output.**
The LLM needs to understand the result. Return Python dicts that are clear and parseable. Use TextFSM or TTP to parse CLI output before returning it.

---

## 3.2 The Base Tool Infrastructure

Create `my-network-agent/tools/base.py`:

```python
from enum import Enum
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import traceback


class ToolCategory(Enum):
    READ = "read"
    WRITE = "write"
    ADMIN = "admin"


@dataclass
class ToolResult:
    success: bool
    data: Any
    error: Optional[str] = None
    tool_name: str = ""
    execution_time_ms: float = 0.0

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "data": self.data,
            "error": self.error,
        }


@dataclass
class ParameterDef:
    name: str
    type: str
    description: str
    required: bool = True
    default: Any = None


class BaseTool:
    """All agent tools inherit from this class."""

    name: str = "base_tool"
    description: str = "Base tool — override this"
    category: ToolCategory = ToolCategory.READ
    parameters: List[ParameterDef] = field(default_factory=list)

    def execute(self, **kwargs) -> ToolResult:
        raise NotImplementedError(f"{self.name} must implement execute()")

    def describe(self) -> dict:
        """Return the tool description the LLM sees."""
        return {
            "name": self.name,
            "description": self.description,
            "category": self.category.value,
            "parameters": [
                {
                    "name": p.name,
                    "type": p.type,
                    "description": p.description,
                    "required": p.required,
                }
                for p in self.parameters
            ],
        }


class ToolRegistry:
    """Manages all registered tools."""

    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}

    def register(self, tool: BaseTool):
        self._tools[tool.name] = tool

    def get(self, name: str) -> Optional[BaseTool]:
        return self._tools.get(name)

    def list_all(self) -> List[BaseTool]:
        return list(self._tools.values())

    def descriptions_for_prompt(self) -> str:
        """Format all tool descriptions for the LLM system prompt."""
        lines = []
        for tool in self._tools.values():
            params = ", ".join(
                f"{p.name}: {p.type}" for p in tool.parameters
            )
            lines.append(f"  - {tool.name}({params}): {tool.description} [CATEGORY: {tool.category.value}]")
        return "\n".join(lines)
```

---

## 3.3 The Safety Gate (Most Important Piece)

Create `my-network-agent/tools/safety.py`:

```python
import sys
from tools.base import BaseTool, ToolCategory, ToolResult


def execute_with_approval(tool: BaseTool, params: dict, auto_approve_reads: bool = True) -> ToolResult:
    """
    Safety wrapper around tool execution.

    READ tools: auto-execute (safe)
    WRITE tools: show params, ask for approval
    ADMIN tools: show params, require typing 'YES I CONFIRM' to proceed
    """
    import time

    # READ tools run automatically
    if tool.category == ToolCategory.READ and auto_approve_reads:
        start = time.time()
        result = tool.execute(**params)
        result.execution_time_ms = (time.time() - start) * 1000
        result.tool_name = tool.name
        return result

    # WRITE tools require yes/no approval
    if tool.category == ToolCategory.WRITE:
        print("\n" + "=" * 60)
        print("  APPROVAL REQUIRED — WRITE OPERATION")
        print("=" * 60)
        print(f"  Tool    : {tool.name}")
        print(f"  Purpose : {tool.description}")
        print(f"  Params  : {params}")
        print("=" * 60)

        user_input = input("  Approve? (y/n): ").strip().lower()
        if user_input != "y":
            return ToolResult(
                success=False,
                data=None,
                error="Cancelled by operator",
                tool_name=tool.name,
            )

    # ADMIN tools require explicit typed confirmation
    if tool.category == ToolCategory.ADMIN:
        print("\n" + "!" * 60)
        print("  ADMIN OPERATION — HIGH RISK")
        print("!" * 60)
        print(f"  Tool    : {tool.name}")
        print(f"  Params  : {params}")
        print(f"  WARNING : This operation may be irreversible.")
        print("!" * 60)

        confirm = input("  Type 'YES I CONFIRM' to proceed: ").strip()
        if confirm != "YES I CONFIRM":
            return ToolResult(
                success=False,
                data=None,
                error="Admin operation rejected — confirmation text did not match",
                tool_name=tool.name,
            )

    # Execute the tool
    start = time.time()
    try:
        result = tool.execute(**params)
        result.execution_time_ms = (time.time() - start) * 1000
        result.tool_name = tool.name
        return result
    except Exception as e:
        return ToolResult(
            success=False,
            data=None,
            error=f"Tool execution failed: {str(e)}",
            tool_name=tool.name,
            execution_time_ms=(time.time() - start) * 1000,
        )
```

---

## 3.4 The SSH Show Command Tool

Create `my-network-agent/tools/show_command.py`:

```python
import json
from tools.base import BaseTool, ToolCategory, ToolResult, ParameterDef

# Demo mode — set to False when connecting to real devices
DEMO_MODE = True

DEMO_DATA = {
    ("rtr-01", "show ip ospf neighbor"): """
Neighbor ID     Pri   State           Dead Time   Address         Interface
3.3.3.3           1   INIT/DROTHER    00:00:35    10.0.1.2        GigabitEthernet0/1
2.2.2.2           1   FULL/DR         00:00:38    10.0.0.2        GigabitEthernet0/0
""",
    ("rtr-01", "show ip ospf interface gi0/1"): """
GigabitEthernet0/1 is up, line protocol is up
  Internet Address 10.0.1.1/30, Area 1, Attached via Network Statement
  Process ID 1, Router ID 1.1.1.1, Network Type BROADCAST, Cost: 1
  Transmit Delay is 1 sec, State DR, Priority 1
  Timer intervals configured, Hello 10, Dead 40, Wait 40, Retransmit 5
""",
    ("rtr-01", "show running-config interface gi0/1"): """
interface GigabitEthernet0/1
 ip address 10.0.1.1 255.255.255.252
 ip ospf 1 area 1
 duplex auto
 speed auto
""",
}


class ShowCommandTool(BaseTool):
    name = "run_show_command"
    description = "Execute a show (read-only) command on a network device via SSH"
    category = ToolCategory.READ
    parameters = [
        ParameterDef("device", "string", "Device hostname or IP address", required=True),
        ParameterDef("command", "string", "The show command to execute (e.g. 'show ip ospf neighbor')", required=True),
    ]

    def execute(self, device: str, command: str) -> ToolResult:
        if DEMO_MODE:
            output = DEMO_DATA.get((device, command.lower().strip()))
            if output:
                return ToolResult(success=True, data={"raw_output": output.strip()})
            return ToolResult(
                success=False,
                data=None,
                error=f"No demo data for device={device} command='{command}'"
            )

        # Real implementation
        try:
            from netmiko import ConnectHandler
            device_params = {
                "device_type": "cisco_ios",
                "host": device,
                "username": "admin",       # Load from env/vault in production
                "password": "secret",
                "timeout": 30,
            }
            with ConnectHandler(**device_params) as conn:
                output = conn.send_command(command)
            return ToolResult(success=True, data={"raw_output": output})
        except Exception as e:
            return ToolResult(success=False, data=None, error=str(e))
```

---

## 3.5 The Config Push Tool (WRITE — Requires Approval)

Create `my-network-agent/tools/config_push.py`:

```python
import difflib
from tools.base import BaseTool, ToolCategory, ToolResult, ParameterDef


def get_running_config(device: str, interface: str) -> str:
    """Fetch current running config for an interface."""
    # Demo implementation
    demo_configs = {
        ("rtr-01", "gi0/1"): (
            "interface GigabitEthernet0/1\n"
            " ip address 10.0.1.1 255.255.255.252\n"
            " ip ospf 1 area 1\n"
        )
    }
    return demo_configs.get((device, interface.lower()), "! No config found")


class ConfigPushTool(BaseTool):
    name = "push_config"
    description = "Apply configuration changes to a network device. REQUIRES human approval."
    category = ToolCategory.WRITE
    parameters = [
        ParameterDef("device", "string", "Device hostname", required=True),
        ParameterDef("config_lines", "list", "List of configuration lines to apply", required=True),
        ParameterDef("interface", "string", "Interface context (optional)", required=False),
    ]

    def execute(self, device: str, config_lines: list, interface: str = None) -> ToolResult:
        # Show diff if we have context
        if interface:
            current = get_running_config(device, interface)
            proposed = "\n".join(config_lines)
            diff = list(difflib.unified_diff(
                current.splitlines(),
                proposed.splitlines(),
                fromfile="current",
                tofile="proposed",
                lineterm="",
            ))
            print("\nConfig diff:")
            for line in diff:
                print(f"  {line}")

        if DEMO_MODE := True:
            print(f"\n[DEMO] Would push to {device}:")
            for line in config_lines:
                print(f"  {line}")
            return ToolResult(success=True, data={"applied": config_lines, "device": device})

        # Real implementation
        try:
            from netmiko import ConnectHandler
            device_params = {"device_type": "cisco_ios", "host": device, ...}
            with ConnectHandler(**device_params) as conn:
                output = conn.send_config_set(config_lines)
            return ToolResult(success=True, data={"output": output, "applied": config_lines})
        except Exception as e:
            return ToolResult(success=False, data=None, error=str(e))
```

---

## 3.6 The NetBox Tool

Create `my-network-agent/tools/netbox.py`:

```python
import os
import requests
from tools.base import BaseTool, ToolCategory, ToolResult, ParameterDef

NETBOX_URL = os.environ.get("NETBOX_URL", "http://netbox.example.com")
NETBOX_TOKEN = os.environ.get("NETBOX_TOKEN", "")

DEMO_DEVICES = {
    "rtr-01": {
        "name": "rtr-01",
        "site": "datacenter-1",
        "role": "core-router",
        "primary_ip": "192.168.1.1",
        "status": "active",
        "tags": ["ospf-backbone", "critical"],
    },
    "rtr-02": {
        "name": "rtr-02",
        "site": "datacenter-1",
        "role": "distribution-router",
        "primary_ip": "192.168.1.2",
        "status": "active",
        "tags": ["ospf-area1"],
    },
}


class NetBoxDeviceTool(BaseTool):
    name = "get_device_info"
    description = "Get device metadata from NetBox: role, site, IP, status, tags"
    category = ToolCategory.READ
    parameters = [
        ParameterDef("device_name", "string", "Device hostname to look up", required=True),
    ]

    def execute(self, device_name: str) -> ToolResult:
        if DEMO_MODE := True:
            device = DEMO_DEVICES.get(device_name)
            if device:
                return ToolResult(success=True, data=device)
            return ToolResult(success=False, data=None, error=f"Device '{device_name}' not in NetBox")

        # Real implementation
        try:
            headers = {"Authorization": f"Token {NETBOX_TOKEN}"}
            url = f"{NETBOX_URL}/api/dcim/devices/?name={device_name}"
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            results = response.json()["results"]
            if not results:
                return ToolResult(success=False, data=None, error=f"Device {device_name} not found in NetBox")
            device = results[0]
            return ToolResult(success=True, data={
                "name": device["name"],
                "site": device["site"]["name"],
                "role": device["device_role"]["name"],
                "primary_ip": device.get("primary_ip", {}).get("address", ""),
                "status": device["status"]["value"],
            })
        except Exception as e:
            return ToolResult(success=False, data=None, error=str(e))
```

---

## 3.7 Wire the Registry

Create `my-network-agent/tools/__init__.py`:

```python
from tools.base import ToolRegistry
from tools.show_command import ShowCommandTool
from tools.config_push import ConfigPushTool
from tools.netbox import NetBoxDeviceTool


def build_tool_registry() -> ToolRegistry:
    """Create and return a registry with all available tools."""
    registry = ToolRegistry()
    registry.register(ShowCommandTool())
    registry.register(ConfigPushTool())
    registry.register(NetBoxDeviceTool())
    return registry
```

---

## Lab 3.1: Add a Config Diff Tool

Build a new READ tool called `get_config_diff` that:
1. Takes `device` and `interface` as parameters
2. Fetches the current running config (use demo data)
3. Takes a `proposed_config` string parameter
4. Returns a unified diff showing what would change

```python
class ConfigDiffTool(BaseTool):
    name = "get_config_diff"
    description = "Show the diff between current and proposed configuration"
    category = ToolCategory.READ  # READ because it doesn't change anything
    parameters = [
        ParameterDef("device", "string", "Device hostname", required=True),
        ParameterDef("interface", "string", "Interface name", required=True),
        ParameterDef("proposed_config", "string", "Proposed new configuration", required=True),
    ]

    def execute(self, device: str, interface: str, proposed_config: str) -> ToolResult:
        # Your implementation here
        pass
```

---

## Lab 3.2: Test the Safety Gate

Run this code and observe what happens:

```python
from tools import build_tool_registry
from tools.safety import execute_with_approval

registry = build_tool_registry()

# Test 1: READ tool — should auto-execute
show_tool = registry.get("run_show_command")
result = execute_with_approval(show_tool, {"device": "rtr-01", "command": "show ip ospf neighbor"})
print("READ result:", result.data)

# Test 2: WRITE tool — should prompt you for approval
push_tool = registry.get("push_config")
result = execute_with_approval(push_tool, {
    "device": "rtr-01",
    "config_lines": ["interface GigabitEthernet0/1", " ip ospf 1 area 0"],
    "interface": "gi0/1"
})
print("WRITE result:", result.data)
```

When the WRITE tool runs, you should see the approval prompt. Try pressing 'n' — verify the config is NOT applied.

---

## Module 3 Quiz

1. Why does `ConfigPushTool` have `category = ToolCategory.WRITE` but `ConfigDiffTool` should be `READ`?
2. What is the purpose of `ToolRegistry.descriptions_for_prompt()`?
3. A new tool needs to reload a device. What category should it be and what confirmation should it require?
4. In `ShowCommandTool.execute()`, why do we parse the output into a structured dict instead of returning raw CLI text?
5. If `NETBOX_TOKEN` is empty, what happens when `NetBoxDeviceTool` runs in demo mode vs real mode?

---

## What's Next

Your tools are built. Now the agent needs to remember things between sessions — so it can say "I've seen this before, last time it was a firewall issue." Module 4 adds memory using a vector database.

**Module 4: Memory and RAG ->**


---

Module 3 · Lesson 2 — Build the Tool Layer

Read time: ~7 min | Module 3 of 8

---

### BaseTool and ToolResult — The Foundation

In Lesson 1 you defined the three access levels as plain string constants. Now you build the classes every tool inherits from.

Two pieces. A ToolResult that every tool returns, and a BaseTool template every tool follows.

```python
READ  = "read"    # privilege 1 — show commands, auto-execute
WRITE = "write"   # privilege 7 — config changes, needs y/n
ADMIN = "admin"   # privilege 15 — destructive ops, needs YES I CONFIRM


class ToolResult:
    """
    Every tool returns this. Always the same three fields.
      success — True or False
      data    — what came back, e.g. {"raw_output": "..."}
      error   — error message if success is False, empty string otherwise
    """
    def __init__(self, success: bool, data: dict, error: str = ""):
        self.success = success
        self.data    = data
        self.error   = error
```

Every tool in the system returns a ToolResult. The agent loop always knows what it is getting back — no guessing about shape.

---

### BaseTool — The Template

Think of BaseTool like a standard interface config template on a Cisco router. The template defines what every interface must have. You never activate the template itself — you apply it to a real interface and fill in the values.

BaseTool works the same way. Every tool must declare:
- name — what the LLM types to call this tool
- description — what it does (the LLM reads this to decide which tool to use)
- category — READ, WRITE, or ADMIN
- parameters — what inputs it needs
- execute() — the actual work

```python
class BaseTool:
    """
    Template that every tool must follow.
    Inherit from this, fill in the four fields, implement execute().
    """
    name        = ""     # e.g. "run_show_command"
    description = ""     # e.g. "Execute a show command via SSH"
    category    = READ   # READ / WRITE / ADMIN
    parameters  = {}     # e.g. {"device": "hostname or IP"}

    def execute(self, **kwargs) -> ToolResult:
        raise NotImplementedError(
            f"Tool '{self.name}' has no execute() method. "
            f"You must implement it before registering this tool."
        )
```

If you forget to implement execute(), you get a clear error — not silent failure.

---

### ToolRegistry — The Toolbox

The registry solves two problems at once.

Problem 1: The LLM produces text like run_show_command. Your Python needs to find the actual tool object that matches that name. Without a registry you need an if/elif chain — one branch per tool.

Problem 2: The LLM needs to know what tools exist. Without a registry you manually paste descriptions into the system prompt.

The registry fixes both: register a tool once, and it is automatically findable by name AND automatically included in the LLM system prompt.

```python
class ToolRegistry:
    def __init__(self):
        self._tools = {}   # { tool_name: tool_object }

    def register(self, tool: BaseTool):
        self._tools[tool.name] = tool
        print(f"Registered: {tool.name} [{tool.category}]")

    def get(self, name: str):
        """Look up a tool by name. Returns None if not found."""
        return self._tools.get(name)

    def describe_all(self) -> str:
        """Generate the tool list for the LLM system prompt."""
        lines = []
        for tool in self._tools.values():
            lines.append(
                f"- {tool.name} [{tool.category}]: "
                f"{tool.description} | params: {tool.parameters}"
            )
        return "\n".join(lines)
```

describe_all() is what gets injected into the system prompt. The LLM reads these descriptions to know what it can ask for.

---

### ShowCommandTool — Your First Real Tool

```python
DEMO_MODE = True  # flip to False when you have real lab devices

DEMO_DATA = {
    ("core-sw-01", "show ip ospf neighbor"): (
        "Neighbor ID     Pri   State      Dead Time   Interface\n"
        "10.0.0.2         1   FULL/DR    00:00:38    Gi0/1\n"
        "10.0.0.3         1   INIT       00:00:32    Gi0/1"
    ),
}


class ShowCommandTool(BaseTool):
    name        = "run_show_command"
    description = "Execute a show command on a network device via SSH"
    category    = READ
    parameters  = {
        "device":  "hostname or IP of the target device",
        "command": "the show command to run (e.g. 'show ip ospf neighbor')",
    }

    def execute(self, device: str, command: str) -> ToolResult:
        if DEMO_MODE:
            output = DEMO_DATA.get((device, command))
            if output is None:
                return ToolResult(
                    success=False, data={},
                    error=f"No demo data for device='{device}' command='{command}'"
                )
            return ToolResult(success=True, data={"raw_output": output})

        from netmiko import ConnectHandler
        conn = ConnectHandler(
            device_type="cisco_ios", host=device,
            username="netadmin", password="LOAD_FROM_ENV",
        )
        output = conn.send_command(command)
        conn.disconnect()
        return ToolResult(success=True, data={"raw_output": output})
```

DEMO_MODE = True returns hardcoded output — no SSH or lab needed. Flip one flag when you have real devices. Nothing else changes.

---

### ConfigDiffTool — Show Exactly What Will Change

Before the agent proposes any config change, it shows exactly what will change — like a git diff. Lines starting with - are removed. Lines starting with + are added. The engineer sees this BEFORE the approval prompt.

Still READ — it only calculates the diff, it does not apply anything.

```python
import difflib

class ConfigDiffTool(BaseTool):
    name        = "show_config_diff"
    description = (
        "Compare current running config against a proposed config block. "
        "Always run this before proposing any configuration change."
    )
    category    = READ
    parameters  = {
        "device":          "hostname or IP",
        "proposed_config": "the config lines you intend to apply",
    }

    def execute(self, device: str, proposed_config: str) -> ToolResult:
        if DEMO_MODE:
            current = DEMO_DATA.get(
                (device, "show running-config"), "! no demo config available"
            )
        else:
            from netmiko import ConnectHandler
            conn = ConnectHandler(
                device_type="cisco_ios", host=device,
                username="netadmin", password="LOAD_FROM_ENV"
            )
            current = conn.send_command("show running-config")
            conn.disconnect()

        diff_lines = difflib.unified_diff(
            current.splitlines(), proposed_config.splitlines(),
            fromfile="running-config", tofile="proposed-config", lineterm=""
        )
        return ToolResult(success=True, data={"diff": "\n".join(diff_lines)})
```

Register both tools and inject the description into the system prompt:

```python
registry = ToolRegistry()
registry.register(ShowCommandTool())
registry.register(ConfigDiffTool())

# In your agent's system prompt:
# print(registry.describe_all())
```

---

Lesson 3 next — the Safety Gate: All Tool Calls Go Through One Function. No Exceptions.
