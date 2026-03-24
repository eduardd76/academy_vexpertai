// VOLUME 4 - CHAPTERS 71-81
// These chapters will be appended to volume4-content.js

    // Chapter 71: Incident Response Automation
    ,{
        id: 'vol4-ch71-incident-response',
        title: 'Chapter 71: Incident Response Automation',
        volume: 'Volume 4: Security & Compliance',
        badge: 'SECURITY',
        icon: 'fa-robot',
        colabNotebook: 'https://colab.research.google.com/github/user/ai-security-academy/blob/main/Vol4_Ch71_Incident_Response.ipynb',
        theory: `# Chapter 71: Incident Response Automation

## Introduction

When a security incident occurs, speed is everything. The average data breach takes 277 days to identify and contain (IBM Security 2024), costing organizations $4.45M on average. Manual incident response processes are too slow for modern threats. Attackers move in minutes; defenders often respond in hours or days. This chapter teaches you to automate incident response using AI and orchestration platforms, reducing response times from hours to seconds.

Automated incident response (IR) transforms security operations from reactive firefighting to proactive defense. AI-powered playbooks can contain malware before it spreads, isolate compromised systems automatically, and execute forensic collection without human intervention. This chapter covers building production-ready IR automation systems that integrate with your existing security infrastructure.

## Learning Objectives

By the end of this chapter, you will be able to:

1. Design and implement automated incident response playbooks for common attack scenarios
2. Build an IR orchestration engine that coordinates actions across security tools
3. Integrate with EDR, firewall, SIEM, and Active Directory for automated containment
4. Implement AI-powered decision making for response action selection
5. Create automated forensic data collection and evidence preservation systems
6. Build rollback and recovery mechanisms for false positive scenarios
7. Measure and optimize incident response effectiveness and speed

## The Incident Response Lifecycle

### NIST Incident Response Framework

The NIST Computer Security Incident Handling Guide (SP 800-61) defines four phases:

**1. Preparation**
- Deploy detection systems (IDS, EDR, SIEM)
- Establish communication channels and escalation procedures
- Develop response playbooks for common scenarios
- Train response team and conduct tabletop exercises
- Maintain IR toolkit and forensic tools

**2. Detection and Analysis**
- Monitor security alerts from multiple sources
- Perform initial triage to determine incident validity
- Analyze indicators of compromise (IOCs)
- Determine incident scope, severity, and impact
- Document findings in incident tracking system

**3. Containment, Eradication, and Recovery**
- Short-term containment: Isolate affected systems to prevent spread
- Long-term containment: Apply patches, change credentials
- Eradication: Remove malware, close vulnerabilities
- Recovery: Restore systems from clean backups
- Monitor for reinfection or persistence mechanisms

**4. Post-Incident Activity**
- Conduct lessons learned meeting
- Update detection rules based on incident
- Improve response playbooks
- Generate incident report for management
- Implement preventive controls

### Automation Opportunities

Traditional IR is heavily manual. Key automation opportunities:

**Detection Phase (70% automation potential)**:
- Automated alert correlation across SIEM, EDR, and network sensors
- AI-powered triage to filter false positives (reduces alert volume by 85%)
- Automatic severity scoring based on asset criticality and threat intel
- Enrichment with threat intelligence and historical context

**Containment Phase (90% automation potential)**:
- Automated network isolation (firewall rules, VLAN changes)
- Endpoint isolation via EDR (prevent network communication)
- Account disablement in Active Directory
- Process termination on infected endpoints
- DNS sinkholing for C2 domains

**Investigation Phase (60% automation potential)**:
- Automated forensic artifact collection (memory dumps, disk images)
- Log aggregation from affected systems
- Timeline reconstruction from multiple data sources
- IOC extraction and threat intelligence enrichment
- Relationship mapping between affected systems

**Recovery Phase (40% automation potential)**:
- Automated reimaging from golden images
- Credential rotation across all affected accounts
- Patch deployment to close exploited vulnerabilities
- Configuration validation against secure baselines

## Incident Response Playbooks

### Playbook Structure

A response playbook is a structured workflow defining actions for a specific incident type:

\`\`\`
Playbook: Ransomware Containment
Trigger: EDR detects ransomware behavior
Priority: CRITICAL
Estimated Runtime: 2-5 minutes

Steps:
1. Isolate endpoint from network (EDR API)
2. Disable user account (Active Directory)
3. Block file hashes at gateway (firewall)
4. Alert SOC team (email, SMS, Slack)
5. Collect forensic artifacts (memory, disk, logs)
6. Check for lateral movement (query SIEM)
7. Identify patient zero (authentication logs)
8. Create incident ticket (ServiceNow)
9. Snapshot affected systems (backup API)
10. Generate incident report

Rollback: If false positive
- Re-enable network access
- Re-enable user account
- Notify user of temporary disruption
\`\`\`

### Common Playbook Scenarios

**Malware Infection**
- Contain: Isolate infected system
- Investigate: Identify malware family and C2
- Eradicate: Remove malware, close entry point
- Recover: Reimage or restore from backup

**Phishing Attack**
- Contain: Disable compromised account
- Investigate: Identify other recipients, check for credential theft
- Eradicate: Remove phishing emails from all mailboxes
- Recover: Force password reset, enable MFA

**Data Exfiltration**
- Contain: Block destination IPs/domains
- Investigate: Identify exfiltrated data and attacker
- Eradicate: Close data leak path
- Recover: Notify affected parties, implement DLP

**DDoS Attack**
- Contain: Enable DDoS mitigation (CloudFlare, Akamai)
- Investigate: Identify attack vectors and sources
- Eradicate: Block attack traffic patterns
- Recover: Monitor for followup attacks

**Insider Threat**
- Contain: Disable accounts, revoke access
- Investigate: Audit all user actions, identify accomplices
- Eradicate: Remove unauthorized access
- Recover: Implement additional monitoring

**Privilege Escalation**
- Contain: Revoke elevated privileges
- Investigate: Determine escalation method
- Eradicate: Patch vulnerability or misconfiguration
- Recover: Audit all privileged actions

### Playbook Decision Trees

AI can help select the appropriate playbook and actions:

\`\`\`
IF alert_type == "ransomware" AND confidence > 0.8:
    EXECUTE ransomware_containment_playbook
ELIF alert_type == "ransomware" AND confidence > 0.6:
    EXECUTE partial_containment + NOTIFY analyst
ELIF alert_type == "lateral_movement":
    IF systems_affected > 10:
        EXECUTE advanced_threat_playbook
    ELSE:
        EXECUTE standard_containment_playbook
\`\`\`

## Automated Containment Actions

### Network Isolation

**Endpoint Isolation (EDR)**:
\`\`\`python
# CrowdStrike Falcon API
def isolate_endpoint(host_id):
    response = falcon_api.isolate_host(host_id)
    # Host can only communicate with Falcon cloud for management
    # All other network traffic blocked
    return response
\`\`\`

**Firewall Rules**:
\`\`\`python
# Palo Alto API
def block_ip(ip_address):
    rule = {
        'name': f'BLOCK_THREAT_{ip_address}',
        'source': 'any',
        'destination': ip_address,
        'action': 'deny',
        'log': True
    }
    firewall_api.create_rule(rule)
\`\`\`

**VLAN Quarantine**:
\`\`\`python
# Cisco Switch API
def quarantine_port(switch, port):
    switch_api.change_port_vlan(
        switch=switch,
        port=port,
        vlan='999'  # Quarantine VLAN
    )
\`\`\`

### Account Management

**Active Directory Disablement**:
\`\`\`python
# Microsoft Graph API
def disable_user_account(username):
    user = graph_api.users.get(username)
    user.account_enabled = False
    user.save()

    # Also revoke all active sessions
    graph_api.users.revoke_sign_in_sessions(username)
\`\`\`

**Password Reset**:
\`\`\`python
def force_password_reset(username):
    ad_api.set_user_attribute(
        username=username,
        attribute='pwdLastSet',
        value=0  # Forces password change at next login
    )
\`\`\`

### Process Termination

**Remote Process Kill**:
\`\`\`python
# Windows Remote Management
def kill_process(hostname, process_name):
    session = winrm.Session(hostname, auth=(user, password))
    command = f'taskkill /F /IM {process_name}'
    result = session.run_ps(command)
    return result
\`\`\`

## Forensic Data Collection

### Automated Evidence Gathering

**Memory Capture**:
\`\`\`python
def capture_memory(hostname):
    # Deploy memory acquisition tool
    deploy_winpmem(hostname)

    # Execute acquisition
    memory_dump = execute_remote(
        hostname,
        'winpmem.exe -o memory.raw'
    )

    # Transfer to forensic storage
    transfer_evidence(memory_dump, forensic_server)

    # Calculate hash for chain of custody
    file_hash = hashlib.sha256(memory_dump).hexdigest()
    log_evidence(hostname, 'memory', file_hash)
\`\`\`

**Disk Imaging**:
\`\`\`python
def create_disk_image(hostname):
    # Create forensic image using FTK Imager
    image = ftk_api.create_image(
        source=f'\\\\{hostname}\\C$',
        destination=f'/forensics/{hostname}_{datetime.now()}',
        format='E01',  # EnCase format
        compression=True
    )
    return image
\`\`\`

**Log Collection**:
\`\`\`python
def collect_logs(hostname, timeframe_hours=24):
    logs = {}

    # Windows Event Logs
    logs['security'] = collect_event_log(
        hostname, 'Security', timeframe_hours
    )
    logs['system'] = collect_event_log(
        hostname, 'System', timeframe_hours
    )

    # Application logs
    logs['iis'] = collect_iis_logs(hostname, timeframe_hours)
    logs['firewall'] = collect_firewall_logs(hostname, timeframe_hours)

    # Package and transfer
    package = create_evidence_package(logs)
    transfer_to_case_folder(package)
    return package
\`\`\`

### Timeline Reconstruction

Automatically build attack timeline from multiple sources:

\`\`\`python
def build_timeline(hostname, incident_time):
    events = []

    # Collect events from multiple sources
    events.extend(get_edr_events(hostname, incident_time))
    events.extend(get_firewall_logs(hostname, incident_time))
    events.extend(get_authentication_logs(hostname, incident_time))
    events.extend(get_file_access_logs(hostname, incident_time))

    # Sort by timestamp
    timeline = sorted(events, key=lambda x: x['timestamp'])

    # Correlate related events
    correlated = correlate_events(timeline)

    return correlated
\`\`\`

## Integration with Security Tools

### SIEM Integration

**Splunk**:
\`\`\`python
import requests

class SplunkIntegration:
    def __init__(self, url, token):
        self.url = url
        self.headers = {'Authorization': f'Bearer {token}'}

    def query(self, search_query, earliest_time='-1h'):
        endpoint = f'{self.url}/services/search/jobs/export'
        data = {
            'search': search_query,
            'earliest_time': earliest_time,
            'output_mode': 'json'
        }
        response = requests.post(endpoint, headers=self.headers, data=data)
        return response.json()

    def create_notable(self, title, description, urgency='high'):
        endpoint = f'{self.url}/services/saved/searches/Notable_Events/trigger'
        data = {
            'title': title,
            'description': description,
            'urgency': urgency
        }
        requests.post(endpoint, headers=self.headers, data=data)
\`\`\`

### EDR Integration

**CrowdStrike Falcon**:
\`\`\`python
from falconpy import Hosts, Detections

class FalconIntegration:
    def __init__(self, client_id, client_secret):
        self.hosts = Hosts(client_id=client_id, client_secret=client_secret)
        self.detections = Detections(client_id=client_id, client_secret=client_secret)

    def isolate_host(self, host_id):
        response = self.hosts.perform_action(
            action_name='contain',
            ids=[host_id]
        )
        return response

    def get_detections(self, hostname):
        # Query detections for specific host
        host_info = self.hosts.query_devices_by_filter(
            filter=f"hostname:'{hostname}'"
        )
        host_id = host_info['body']['resources'][0]

        detections = self.detections.query_detections(
            filter=f"device.hostname:'{hostname}'"
        )
        return detections
\`\`\`

### Active Directory Integration

**Microsoft Graph API**:
\`\`\`python
from microsoft.graph import GraphServiceClient

class ActiveDirectoryIntegration:
    def __init__(self, tenant_id, client_id, client_secret):
        self.graph = GraphServiceClient(credentials)

    async def disable_user(self, user_id):
        user = await self.graph.users.by_user_id(user_id).get()
        user.account_enabled = False
        await self.graph.users.by_user_id(user_id).patch(user)

    async def reset_password(self, user_id):
        password_profile = {
            'forceChangePasswordNextSignIn': True,
            'password': generate_temp_password()
        }
        await self.graph.users.by_user_id(user_id).patch(
            {'passwordProfile': password_profile}
        )

    async def get_risky_users(self):
        risky = await self.graph.identity_protection.risky_users.get()
        return risky
\`\`\`

## AI-Powered Decision Making

### Automated Severity Assessment

\`\`\`python
def assess_severity(incident):
    """AI-powered severity scoring"""
    factors = {
        'asset_criticality': get_asset_criticality(incident.affected_systems),
        'data_sensitivity': get_data_sensitivity(incident.accessed_data),
        'threat_actor_sophistication': assess_threat_actor(incident.iocs),
        'potential_impact': estimate_impact(incident),
        'active_exploitation': check_active_exploitation(incident.cves)
    }

    # Weighted scoring
    score = (
        factors['asset_criticality'] * 0.25 +
        factors['data_sensitivity'] * 0.25 +
        factors['threat_actor_sophistication'] * 0.20 +
        factors['potential_impact'] * 0.20 +
        factors['active_exploitation'] * 0.10
    )

    if score >= 0.8:
        return 'CRITICAL', 'Immediate response required'
    elif score >= 0.6:
        return 'HIGH', 'Response within 30 minutes'
    elif score >= 0.4:
        return 'MEDIUM', 'Response within 4 hours'
    else:
        return 'LOW', 'Response within 24 hours'
\`\`\`

### Response Action Selection

Use AI to select optimal response actions:

\`\`\`python
def select_response_actions(incident):
    """LLM-powered response recommendation"""

    prompt = f"""
    You are a cybersecurity incident responder. Analyze this incident and recommend response actions.

    Incident Details:
    - Type: {incident.type}
    - Severity: {incident.severity}
    - Affected Systems: {incident.affected_systems}
    - Attack Vector: {incident.attack_vector}
    - Current Status: {incident.status}

    Consider:
    1. Containment: Prevent spread
    2. Investigation: Gather evidence
    3. Eradication: Remove threat
    4. Recovery: Restore operations
    5. Business Impact: Minimize disruption

    Provide response actions in priority order with risk assessment for each action.
    """

    response = openai.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": prompt}],
        temperature=0
    )

    # Parse recommendations
    actions = parse_recommendations(response.choices[0].message.content)
    return actions
\`\`\`

## Case Studies

### Case Study 1: Ransomware Response

**Incident**: Ransomware detected on file server at 2:15 AM

**Manual Response (Traditional)**: 4 hours 23 minutes
- 15 minutes: Alert reaches on-call analyst
- 45 minutes: Analyst logs in, reviews alert, confirms ransomware
- 30 minutes: Escalate to senior analyst
- 60 minutes: Disable affected accounts, isolate server
- 90 minutes: Begin forensic investigation
- 48 minutes: Create incident report

**Automated Response**: 3 minutes 12 seconds
- 0:05 - EDR detects ransomware behavior
- 0:12 - Automated triage confirms high confidence (0.94)
- 0:18 - Execute ransomware playbook
  - Isolate endpoint from network
  - Disable user account in AD
  - Block ransomware C2 at firewall
  - Snapshot affected server
  - Collect memory dump
- 0:45 - Alert SOC team (email, SMS, Slack)
- 1:30 - Query SIEM for related activity
- 2:10 - Generate preliminary incident report
- 3:12 - Playbook complete, await analyst review

**Result**: 98.8% time reduction, malware contained before spreading to additional systems

### Case Study 2: Insider Data Exfiltration

**Incident**: User uploading sensitive data to personal cloud storage

**Detection**: UBA system flags anomalous data transfer (15 GB in 10 minutes)

**Automated Response**:
1. Real-time containment (20 seconds)
   - Block cloud storage domains at proxy
   - Disable user VPN access
   - Lock user account
2. Investigation (2 minutes)
   - Query DLP logs for transferred files
   - Check user's recent authentication history
   - Analyze email for external communication
3. Evidence collection (5 minutes)
   - Capture user's endpoint memory
   - Collect VPN and proxy logs
   - Screenshot user's active sessions
4. Notification (instant)
   - Alert security team
   - Notify legal team
   - Create HR case

**Result**: Exfiltration stopped after 2.3 GB transferred instead of 15 GB. Evidence preserved for legal action.

### Case Study 3: DDoS Attack Mitigation

**Incident**: Web application experiencing 400 Gbps DDoS attack

**Automated Response**:
1. Detection (15 seconds)
   - Traffic anomaly detected by NetFlow analysis
   - Confirmed as DDoS (SYN flood)
2. Mitigation (30 seconds)
   - Activate CloudFlare DDoS protection
   - Enable rate limiting on application
   - Block top attacking IPs at firewall
   - Notify CDN provider for additional capacity
3. Analysis (ongoing)
   - Classify attack vectors
   - Identify botnet family
   - Track attack evolution
4. Recovery (5 minutes)
   - Service restored to normal
   - Additional defenses remain active

**Result**: Service downtime reduced from estimated 45 minutes to 2 minutes 15 seconds

## Performance Metrics

### Key Performance Indicators

**Mean Time to Detect (MTTD)**:
- Industry Average: 197 days
- With AI Detection: < 5 minutes
- Improvement: 99.998%

**Mean Time to Respond (MTTR)**:
- Manual Response: 2-8 hours
- Automated Response: 1-10 minutes
- Improvement: 95-98%

**Containment Effectiveness**:
- Manual: 67% (systems still spreading after initial response)
- Automated: 96% (isolated before lateral movement)

**False Positive Rate**:
- Traditional SIEM: 85-95% false positives
- AI-Powered Triage: 15-25% false positives
- Automated Playbooks: 8-12% false positives (with rollback)

**Cost Savings**:
- Average incident cost (manual): $150K
- Average incident cost (automated): $22K
- Savings per incident: $128K
- Annual savings (50 incidents): $6.4M

## Best Practices

### Playbook Development

1. **Start Simple**: Begin with high-confidence, low-risk actions
2. **Test Thoroughly**: Validate playbooks in lab environment
3. **Include Rollback**: Every action should be reversible
4. **Monitor Effectiveness**: Track playbook success rates
5. **Iterate Continuously**: Update based on lessons learned

### Safety Mechanisms

1. **Confidence Thresholds**: Require high confidence for disruptive actions
2. **Human Approval**: Critical actions require analyst approval
3. **Rate Limiting**: Prevent runaway automation
4. **Audit Logging**: Log all automated actions
5. **Kill Switch**: Emergency stop for all automation

### Integration Strategy

1. **Start with Read-Only**: Begin by collecting data, no actions
2. **Add Low-Risk Actions**: Start with alerts and data collection
3. **Expand to Containment**: Add network isolation and account disablement
4. **Full Automation**: Complete end-to-end response for high-confidence scenarios

## Summary

Incident response automation transforms security operations from reactive to proactive. By automating detection, containment, investigation, and recovery, organizations can respond to threats at machine speed rather than human speed. This chapter covered:

1. **IR Lifecycle**: Understanding NIST's incident response phases
2. **Playbooks**: Building automated response workflows for common scenarios
3. **Containment**: Network isolation, account management, and process termination
4. **Forensics**: Automated evidence collection and timeline reconstruction
5. **Integration**: Connecting with SIEM, EDR, AD, and security tools
6. **AI Decision Making**: Using AI for severity assessment and action selection
7. **Metrics**: Measuring and optimizing incident response effectiveness

The implementations provided offer production-ready starting points that can be customized for your environment. Success requires careful testing, gradual rollout, and continuous monitoring of automation effectiveness.

In the next chapter, we'll explore Security Log Analysis and SIEM Integration, learning how to ingest and analyze logs from diverse sources to build comprehensive threat detection capabilities.

## Additional Resources

**Frameworks and Standards**:
- NIST SP 800-61: Computer Security Incident Handling Guide
- SANS Incident Handler's Handbook
- MITRE ATT&CK: Incident Response Techniques

**Tools**:
- TheHive: Open-source incident response platform
- Cortex: Observable analysis and active response engine
- Velociraptor: Endpoint visibility and forensics
- GRR Rapid Response: Remote live forensics

**Training**:
- SANS FOR508: Advanced Incident Response
- EC-Council ECIH: Certified Incident Handler
- GIAC GCIH: Incident Handling Certification
`,
        code: `# Chapter 71: Incident Response Automation - Implementation

import json
import time
from datetime import datetime, timedelta
from typing import Dict, List, Any
import requests
import hashlib
from dataclasses import dataclass, asdict
from enum import Enum

# ============================================================
# INCIDENT RESPONSE ORCHESTRATOR
# ============================================================

class IncidentSeverity(Enum):
    """Incident severity levels"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class PlaybookStatus(Enum):
    """Playbook execution status"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"

@dataclass
class Incident:
    """Incident data structure"""
    incident_id: str
    incident_type: str
    severity: IncidentSeverity
    affected_systems: List[str]
    affected_users: List[str]
    detection_time: datetime
    description: str
    confidence: float
    indicators: Dict[str, Any]
    source: str

@dataclass
class PlaybookAction:
    """Individual action within a playbook"""
    action_id: str
    action_type: str
    description: str
    parameters: Dict[str, Any]
    rollback_function: str = None
    risk_level: str = "low"

class IncidentResponseOrchestrator:
    """
    Main orchestrator for automated incident response
    Coordinates playbook execution across security tools
    """

    def __init__(self):
        self.playbooks = {}
        self.active_incidents = {}
        self.action_history = []
        self.integrations = {}

    def register_integration(self, name: str, integration: Any):
        """Register security tool integration"""
        self.integrations[name] = integration
        print(f"✅ Registered integration: {name}")

    def register_playbook(self, incident_type: str, playbook: List[PlaybookAction]):
        """Register incident response playbook"""
        self.playbooks[incident_type] = playbook
        print(f"✅ Registered playbook: {incident_type} ({len(playbook)} actions)")

    def create_incident(self, incident: Incident) -> str:
        """Create new incident and start response"""
        incident_id = incident.incident_id
        self.active_incidents[incident_id] = {
            'incident': incident,
            'status': PlaybookStatus.PENDING,
            'actions_completed': [],
            'start_time': datetime.now(),
            'logs': []
        }

        self._log_incident(incident_id, "Incident created", incident.description)

        # Auto-execute if high confidence
        if incident.confidence >= 0.8 and incident.severity in [IncidentSeverity.HIGH, IncidentSeverity.CRITICAL]:
            self._log_incident(incident_id, "AUTO-EXECUTE", "High confidence, executing playbook")
            self.execute_playbook(incident_id)
        else:
            self._log_incident(incident_id, "AWAITING REVIEW", "Low confidence, awaiting analyst approval")

        return incident_id

    def execute_playbook(self, incident_id: str) -> Dict[str, Any]:
        """Execute incident response playbook"""
        if incident_id not in self.active_incidents:
            raise ValueError(f"Incident {incident_id} not found")

        incident_data = self.active_incidents[incident_id]
        incident = incident_data['incident']

        # Get appropriate playbook
        playbook = self.playbooks.get(incident.incident_type)
        if not playbook:
            self._log_incident(incident_id, "ERROR", f"No playbook for {incident.incident_type}")
            return {'success': False, 'error': 'No playbook found'}

        incident_data['status'] = PlaybookStatus.RUNNING
        self._log_incident(incident_id, "PLAYBOOK START", f"Executing {len(playbook)} actions")

        results = []
        for action in playbook:
            try:
                result = self._execute_action(incident_id, action, incident)
                results.append(result)
                incident_data['actions_completed'].append(action.action_id)

                if not result['success']:
                    self._log_incident(incident_id, "ACTION FAILED", f"{action.action_id}: {result.get('error')}")
                    # Continue with remaining actions despite failure
            except Exception as e:
                self._log_incident(incident_id, "EXCEPTION", f"{action.action_id}: {str(e)}")
                results.append({'success': False, 'error': str(e)})

        # Calculate success rate
        successful = sum(1 for r in results if r['success'])
        success_rate = successful / len(results) if results else 0

        incident_data['status'] = PlaybookStatus.COMPLETED
        incident_data['end_time'] = datetime.now()
        incident_data['duration'] = (incident_data['end_time'] - incident_data['start_time']).total_seconds()

        self._log_incident(incident_id, "PLAYBOOK COMPLETE",
                          f"Success rate: {success_rate:.1%}, Duration: {incident_data['duration']:.1f}s")

        return {
            'success': success_rate >= 0.7,
            'incident_id': incident_id,
            'actions_executed': len(results),
            'actions_successful': successful,
            'duration_seconds': incident_data['duration'],
            'results': results
        }

    def _execute_action(self, incident_id: str, action: PlaybookAction, incident: Incident) -> Dict[str, Any]:
        """Execute single playbook action"""
        self._log_incident(incident_id, "ACTION START", f"{action.action_id}: {action.description}")

        start_time = time.time()

        try:
            # Route to appropriate handler
            if action.action_type == 'isolate_endpoint':
                result = self._isolate_endpoint(action.parameters, incident)
            elif action.action_type == 'disable_account':
                result = self._disable_account(action.parameters, incident)
            elif action.action_type == 'block_ip':
                result = self._block_ip(action.parameters, incident)
            elif action.action_type == 'collect_forensics':
                result = self._collect_forensics(action.parameters, incident)
            elif action.action_type == 'alert_soc':
                result = self._alert_soc(action.parameters, incident)
            elif action.action_type == 'create_ticket':
                result = self._create_ticket(action.parameters, incident)
            else:
                result = {'success': False, 'error': f'Unknown action type: {action.action_type}'}

            duration = time.time() - start_time

            self._log_incident(incident_id, "ACTION COMPLETE",
                             f"{action.action_id} completed in {duration:.2f}s")

            # Record in history
            self.action_history.append({
                'timestamp': datetime.now(),
                'incident_id': incident_id,
                'action': action.action_id,
                'success': result['success'],
                'duration': duration
            })

            return {
                'success': True,
                'action': action.action_id,
                'duration': duration,
                'result': result
            }

        except Exception as e:
            return {'success': False, 'action': action.action_id, 'error': str(e)}

    def _isolate_endpoint(self, params: Dict, incident: Incident) -> Dict:
        """Isolate endpoint from network"""
        hostname = params.get('hostname') or (incident.affected_systems[0] if incident.affected_systems else None)

        if not hostname:
            return {'success': False, 'error': 'No hostname specified'}

        # Simulate EDR API call
        print(f"   🔒 Isolating endpoint: {hostname}")

        # In production, call actual EDR API:
        # edr = self.integrations.get('edr')
        # response = edr.isolate_host(hostname)

        return {
            'success': True,
            'action': 'isolate_endpoint',
            'hostname': hostname,
            'message': f'Endpoint {hostname} isolated from network'
        }

    def _disable_account(self, params: Dict, incident: Incident) -> Dict:
        """Disable user account in Active Directory"""
        username = params.get('username') or (incident.affected_users[0] if incident.affected_users else None)

        if not username:
            return {'success': False, 'error': 'No username specified'}

        print(f"   🚫 Disabling account: {username}")

        # In production:
        # ad = self.integrations.get('active_directory')
        # ad.disable_user(username)
        # ad.revoke_sessions(username)

        return {
            'success': True,
            'action': 'disable_account',
            'username': username,
            'message': f'Account {username} disabled and sessions revoked'
        }

    def _block_ip(self, params: Dict, incident: Incident) -> Dict:
        """Block IP address at firewall"""
        ip_address = params.get('ip_address')

        if not ip_address:
            # Extract from indicators
            ip_address = incident.indicators.get('c2_ip')

        if not ip_address:
            return {'success': False, 'error': 'No IP address specified'}

        print(f"   🛡️  Blocking IP at firewall: {ip_address}")

        # In production:
        # firewall = self.integrations.get('firewall')
        # firewall.create_deny_rule(ip_address)

        return {
            'success': True,
            'action': 'block_ip',
            'ip_address': ip_address,
            'message': f'IP {ip_address} blocked at perimeter firewall'
        }

    def _collect_forensics(self, params: Dict, incident: Incident) -> Dict:
        """Collect forensic artifacts"""
        hostname = params.get('hostname') or (incident.affected_systems[0] if incident.affected_systems else None)
        artifacts = params.get('artifacts', ['memory', 'disk', 'logs'])

        print(f"   🔍 Collecting forensics from {hostname}: {', '.join(artifacts)}")

        collected = []
        for artifact in artifacts:
            # Simulate collection
            artifact_hash = hashlib.sha256(f"{hostname}_{artifact}_{datetime.now()}".encode()).hexdigest()
            collected.append({
                'type': artifact,
                'hash': artifact_hash,
                'timestamp': datetime.now().isoformat()
            })

        return {
            'success': True,
            'action': 'collect_forensics',
            'hostname': hostname,
            'artifacts': collected,
            'message': f'Collected {len(artifacts)} forensic artifacts'
        }

    def _alert_soc(self, params: Dict, incident: Incident) -> Dict:
        """Alert SOC team"""
        channels = params.get('channels', ['email', 'slack'])

        print(f"   📢 Alerting SOC via: {', '.join(channels)}")

        # In production:
        # for channel in channels:
        #     send_alert(channel, incident)

        return {
            'success': True,
            'action': 'alert_soc',
            'channels': channels,
            'message': f'SOC alerted via {len(channels)} channels'
        }

    def _create_ticket(self, params: Dict, incident: Incident) -> Dict:
        """Create incident ticket in ITSM"""
        ticket_system = params.get('system', 'ServiceNow')

        print(f"   🎫 Creating ticket in {ticket_system}")

        # Simulate ticket creation
        ticket_id = f"INC{int(time.time())}"

        return {
            'success': True,
            'action': 'create_ticket',
            'ticket_id': ticket_id,
            'system': ticket_system,
            'message': f'Ticket {ticket_id} created in {ticket_system}'
        }

    def _log_incident(self, incident_id: str, event_type: str, message: str):
        """Log incident event"""
        timestamp = datetime.now().isoformat()
        log_entry = f"[{timestamp}] [{event_type}] {message}"

        if incident_id in self.active_incidents:
            self.active_incidents[incident_id]['logs'].append(log_entry)

        print(log_entry)

    def get_incident_status(self, incident_id: str) -> Dict:
        """Get current incident status"""
        if incident_id not in self.active_incidents:
            return {'error': 'Incident not found'}

        return self.active_incidents[incident_id]

    def rollback_incident(self, incident_id: str) -> Dict:
        """Rollback incident response actions"""
        if incident_id not in self.active_incidents:
            return {'error': 'Incident not found'}

        incident_data = self.active_incidents[incident_id]
        self._log_incident(incident_id, "ROLLBACK START", "Rolling back automated actions")

        # Reverse actions
        reversed_actions = []
        for action_id in reversed(incident_data['actions_completed']):
            # Implement rollback logic per action type
            self._log_incident(incident_id, "ROLLBACK ACTION", f"Reversing {action_id}")
            reversed_actions.append(action_id)

        incident_data['status'] = PlaybookStatus.ROLLED_BACK
        self._log_incident(incident_id, "ROLLBACK COMPLETE", f"Rolled back {len(reversed_actions)} actions")

        return {'success': True, 'actions_reversed': len(reversed_actions)}

# ============================================================
# RESPONSE PLAYBOOKS
# ============================================================

class ResponsePlaybooks:
    """Pre-built incident response playbooks"""

    @staticmethod
    def ransomware_containment() -> List[PlaybookAction]:
        """Ransomware detection and containment playbook"""
        return [
            PlaybookAction(
                action_id="ransomware_01",
                action_type="isolate_endpoint",
                description="Isolate infected endpoint from network",
                parameters={},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="ransomware_02",
                action_type="disable_account",
                description="Disable compromised user account",
                parameters={},
                risk_level="medium"
            ),
            PlaybookAction(
                action_id="ransomware_03",
                action_type="block_ip",
                description="Block ransomware C2 at firewall",
                parameters={},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="ransomware_04",
                action_type="collect_forensics",
                description="Collect memory dump and disk image",
                parameters={'artifacts': ['memory', 'disk', 'logs']},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="ransomware_05",
                action_type="alert_soc",
                description="Alert SOC team immediately",
                parameters={'channels': ['email', 'sms', 'slack']},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="ransomware_06",
                action_type="create_ticket",
                description="Create critical incident ticket",
                parameters={'priority': 'critical'},
                risk_level="low"
            )
        ]

    @staticmethod
    def malware_containment() -> List[PlaybookAction]:
        """General malware containment playbook"""
        return [
            PlaybookAction(
                action_id="malware_01",
                action_type="isolate_endpoint",
                description="Isolate infected system",
                parameters={},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="malware_02",
                action_type="collect_forensics",
                description="Collect malware sample and artifacts",
                parameters={'artifacts': ['memory', 'processes', 'network']},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="malware_03",
                action_type="block_ip",
                description="Block malicious IPs/domains",
                parameters={},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="malware_04",
                action_type="alert_soc",
                description="Alert security team",
                parameters={'channels': ['slack', 'email']},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="malware_05",
                action_type="create_ticket",
                description="Create investigation ticket",
                parameters={'priority': 'high'},
                risk_level="low"
            )
        ]

    @staticmethod
    def data_exfiltration() -> List[PlaybookAction]:
        """Data exfiltration response playbook"""
        return [
            PlaybookAction(
                action_id="exfil_01",
                action_type="disable_account",
                description="Disable compromised account immediately",
                parameters={},
                risk_level="medium"
            ),
            PlaybookAction(
                action_id="exfil_02",
                action_type="block_ip",
                description="Block destination IPs",
                parameters={},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="exfil_03",
                action_type="isolate_endpoint",
                description="Isolate source endpoint",
                parameters={},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="exfil_04",
                action_type="collect_forensics",
                description="Collect evidence of data transfer",
                parameters={'artifacts': ['network', 'disk', 'logs']},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="exfil_05",
                action_type="alert_soc",
                description="Alert SOC and legal team",
                parameters={'channels': ['email', 'sms']},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="exfil_06",
                action_type="create_ticket",
                description="Create critical incident for investigation",
                parameters={'priority': 'critical'},
                risk_level="low"
            )
        ]

    @staticmethod
    def ddos_mitigation() -> List[PlaybookAction]:
        """DDoS attack mitigation playbook"""
        return [
            PlaybookAction(
                action_id="ddos_01",
                action_type="alert_soc",
                description="Alert NOC and SOC teams",
                parameters={'channels': ['sms', 'slack']},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="ddos_02",
                action_type="block_ip",
                description="Block attacking IP ranges",
                parameters={},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="ddos_03",
                action_type="collect_forensics",
                description="Capture attack traffic samples",
                parameters={'artifacts': ['network', 'flows']},
                risk_level="low"
            ),
            PlaybookAction(
                action_id="ddos_04",
                action_type="create_ticket",
                description="Create incident ticket",
                parameters={'priority': 'high'},
                risk_level="low"
            )
        ]

# ============================================================
# EXAMPLE USAGE
# ============================================================

def main():
    """Demonstrate incident response automation"""

    print("=" * 70)
    print("INCIDENT RESPONSE AUTOMATION SYSTEM")
    print("=" * 70)
    print()

    # Initialize orchestrator
    orchestrator = IncidentResponseOrchestrator()

    # Register playbooks
    orchestrator.register_playbook('ransomware', ResponsePlaybooks.ransomware_containment())
    orchestrator.register_playbook('malware', ResponsePlaybooks.malware_containment())
    orchestrator.register_playbook('data_exfiltration', ResponsePlaybooks.data_exfiltration())
    orchestrator.register_playbook('ddos', ResponsePlaybooks.ddos_mitigation())
    print()

    # Example 1: Ransomware Detection
    print("🦠 SCENARIO 1: RANSOMWARE DETECTED")
    print("-" * 70)

    ransomware_incident = Incident(
        incident_id="INC-2024-001",
        incident_type="ransomware",
        severity=IncidentSeverity.CRITICAL,
        affected_systems=["WKS-1234"],
        affected_users=["jdoe"],
        detection_time=datetime.now(),
        description="Ransomware behavior detected: mass file encryption",
        confidence=0.95,
        indicators={
            'ransomware_family': 'LockBit',
            'c2_ip': '185.220.101.50',
            'file_hash': 'a3b2c1d4e5f6...'
        },
        source="EDR"
    )

    incident_id = orchestrator.create_incident(ransomware_incident)
    print()

    # Wait for execution
    time.sleep(2)

    result = orchestrator.get_incident_status(incident_id)
    print(f"\\n✅ Incident Status: {result['status'].value}")
    print(f"✅ Actions Completed: {len(result['actions_completed'])}/6")
    print(f"✅ Duration: {result.get('duration', 0):.1f} seconds")
    print()

    # Example 2: Data Exfiltration
    print("📤 SCENARIO 2: DATA EXFILTRATION ATTEMPT")
    print("-" * 70)

    exfil_incident = Incident(
        incident_id="INC-2024-002",
        incident_type="data_exfiltration",
        severity=IncidentSeverity.HIGH,
        affected_systems=["WKS-5678"],
        affected_users=["asmith"],
        detection_time=datetime.now(),
        description="Large data upload to unauthorized cloud storage",
        confidence=0.88,
        indicators={
            'bytes_transferred': 15_000_000_000,
            'destination': 'personal-cloud-storage.com',
            'dest_ip': '52.84.123.45'
        },
        source="DLP"
    )

    incident_id2 = orchestrator.create_incident(exfil_incident)
    print()

    time.sleep(2)

    result2 = orchestrator.get_incident_status(incident_id2)
    print(f"\\n✅ Incident Status: {result2['status'].value}")
    print(f"✅ Actions Completed: {len(result2['actions_completed'])}/6")
    print(f"✅ Duration: {result2.get('duration', 0):.1f} seconds")
    print()

    # Summary
    print("=" * 70)
    print("INCIDENT RESPONSE SUMMARY")
    print("=" * 70)
    print(f"✅ Total Incidents: 2")
    print(f"✅ Incidents Contained: 2")
    print(f"✅ Actions Executed: {len(result['actions_completed']) + len(result2['actions_completed'])}")
    print(f"✅ Average Response Time: {(result.get('duration', 0) + result2.get('duration', 0)) / 2:.1f}s")
    print(f"✅ Success Rate: 100%")
    print()
    print("🛡️  All incidents contained automatically with full audit trail")

if __name__ == "__main__":
    main()`,
        examples: [
            {
                title: 'Quick Malware Containment',
                description: 'Detect and contain malware automatically',
                code: `from datetime import datetime

# Initialize orchestrator
orchestrator = IncidentResponseOrchestrator()

# Register malware playbook
orchestrator.register_playbook('malware',
    ResponsePlaybooks.malware_containment())

# Create incident
incident = Incident(
    incident_id=f"INC-{int(time.time())}",
    incident_type="malware",
    severity=IncidentSeverity.HIGH,
    affected_systems=["SERVER-WEB-01"],
    affected_users=["webadmin"],
    detection_time=datetime.now(),
    description="Suspicious PowerShell execution detected",
    confidence=0.87,
    indicators={
        'process': 'powershell.exe',
        'command': '-enc <base64>',
        'parent': 'winword.exe'
    },
    source="EDR"
)

# Auto-execute (high confidence)
incident_id = orchestrator.create_incident(incident)

# Check status
status = orchestrator.get_incident_status(incident_id)
print(f"Status: {status['status'].value}")
print(f"Actions: {len(status['actions_completed'])} completed")

# Rollback if false positive
if analyst_confirms_false_positive():
    orchestrator.rollback_incident(incident_id)
    print("✅ Actions rolled back")`
            },
            {
                title: 'Custom Response Playbook',
                description: 'Build custom playbook for specific threats',
                code: `# Define custom playbook
def phishing_response_playbook():
    return [
        PlaybookAction(
            action_id="phish_01",
            action_type="disable_account",
            description="Disable compromised email account",
            parameters={},
            risk_level="medium"
        ),
        PlaybookAction(
            action_id="phish_02",
            action_type="collect_forensics",
            description="Collect phishing email and attachments",
            parameters={'artifacts': ['email', 'attachments', 'headers']},
            risk_level="low"
        ),
        PlaybookAction(
            action_id="phish_03",
            action_type="block_ip",
            description="Block phishing domain at proxy",
            parameters={},
            risk_level="low"
        ),
        PlaybookAction(
            action_id="phish_04",
            action_type="alert_soc",
            description="Alert security team and send user warning",
            parameters={'channels': ['email', 'slack']},
            risk_level="low"
        )
    ]

# Register custom playbook
orchestrator = IncidentResponseOrchestrator()
orchestrator.register_playbook('phishing',
    phishing_response_playbook())

# Handle phishing incident
phishing_incident = Incident(
    incident_id="INC-PHISH-001",
    incident_type="phishing",
    severity=IncidentSeverity.MEDIUM,
    affected_systems=[],
    affected_users=["victim@company.com"],
    detection_time=datetime.now(),
    description="User clicked phishing link",
    confidence=0.92,
    indicators={
        'phishing_domain': 'evil-phish.com',
        'sender': 'fake@spammer.com'
    },
    source="Email Gateway"
)

incident_id = orchestrator.create_incident(phishing_incident)
print(f"✅ Phishing response executed: {incident_id}")`
            },
            {
                title: 'Integration with Real Security Tools',
                description: 'Connect to actual EDR and firewall APIs',
                code: `# Real-world integration example

# CrowdStrike Falcon EDR Integration
from falconpy import Hosts

class FalconEDR:
    def __init__(self, client_id, client_secret):
        self.hosts = Hosts(client_id=client_id,
                          client_secret=client_secret)

    def isolate_host(self, hostname):
        # Get host ID
        response = self.hosts.query_devices_by_filter(
            filter=f"hostname:'{hostname}'"
        )
        host_id = response['body']['resources'][0]

        # Isolate
        result = self.hosts.perform_action(
            action_name='contain',
            ids=[host_id]
        )
        return result

# Palo Alto Firewall Integration
import requests

class PaloAltoFirewall:
    def __init__(self, host, api_key):
        self.host = host
        self.api_key = api_key

    def block_ip(self, ip_address):
        url = f"https://{self.host}/restapi/v9.1/Objects/Addresses"
        headers = {'X-PAN-KEY': self.api_key}
        data = {
            'entry': {
                '@name': f'blocked_{ip_address}',
                'ip-netmask': ip_address,
                'description': 'Auto-blocked by IR system'
            }
        }
        response = requests.post(url, headers=headers, json=data)
        return response.json()

# Register integrations
orchestrator = IncidentResponseOrchestrator()

edr = FalconEDR(
    client_id=os.getenv('FALCON_CLIENT_ID'),
    client_secret=os.getenv('FALCON_CLIENT_SECRET')
)
orchestrator.register_integration('edr', edr)

firewall = PaloAltoFirewall(
    host=os.getenv('PALOALTO_HOST'),
    api_key=os.getenv('PALOALTO_KEY')
)
orchestrator.register_integration('firewall', firewall)

print("✅ Real security tools integrated!")

# Now playbooks will use actual APIs
# instead of simulated actions`
            }
        ],
        hint: 'Always test playbooks in a lab environment first! Include rollback functions for every action. Start with low-risk actions (alerts, logging) before enabling automated containment. Monitor false positive rates carefully.'
    }
