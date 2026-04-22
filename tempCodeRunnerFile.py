from flask import Flask, render_template, request, jsonify, send_file
import pandas as pd
import networkx as nx
import json
import io
import time
import numpy as np
from pymongo import MongoClient
from dotenv import load_dotenv
import os

load_dotenv()

client = MongoClient(os.getenv("MONGO_URI"))
db = client["Finforensics"]
collection = db["analysis"]

app = Flask(__name__)
analysis_result = None

def generate_ai_narrative(account_id, score, patterns):
    """Generates a dynamic narrative for the AI Investigator panel."""
    pattern_str = ", ".join([p.replace('_', ' ') for p in patterns]) if patterns else "anomalous behavior"
    
    if score >= 85:
        stage = "Stage 2: Active Layering Mule"
        action = "Immediately initiate a comprehensive review of the account's transactions and freeze outgoing transfers."
    elif score >= 60:
        stage = "Stage 1: Newly Activated Mule"
        action = "Flag for secondary review and monitor closely for fan-out behavior."
    else:
        stage = "Suspected Smurf Node"
        action = "Add to watchlist."

    narrative = f"This account, {account_id}, has been identified as a high-risk entity with a suspicious activity score of {score}/100, indicating a significant likelihood of financial crime involvement. The observed patterns of {pattern_str}, combined with the account's classification within {stage}, suggest a complex money laundering operation. Recommended Action: {action}"
    
    return narrative, stage

@app.route('/')
def home():
    return render_template("index.html")

@app.route('/upload', methods=['POST'])
def upload():
    global analysis_result
    start_time = time.time()

    file = request.files['file']
    df = pd.read_csv(file)
    df['timestamp'] = pd.to_datetime(df['timestamp'])

    G = nx.DiGraph()
    for _, row in df.iterrows():
        G.add_edge(row['sender_id'], row['receiver_id'], amount=row['amount'], timestamp=row['timestamp'])

    suspicious_accounts = {}
    fraud_rings = []
    ring_counter = 1

    # Cycle detection
    cycles = list(nx.simple_cycles(G))
    for cycle in cycles:
        if 3 <= len(cycle) <= 6:
            ring_id = f"RING_{ring_counter:03d}"
            ring_counter += 1
            fraud_rings.append({
                "ring_id": ring_id,
                "member_accounts": cycle,
                "pattern_type": "cycle",
                "risk_score": 95.0
            })
            for acc in cycle:
                if acc not in suspicious_accounts:
                    suspicious_accounts[acc] = {"account_id": acc, "cycle_score": 0, "temporal_score": 0, "flow_score": 0, "diversity_score": 0, "amount_score": 0, "ring_id": ring_id}
                suspicious_accounts[acc]["cycle_score"] = 1

    # Feature engineering
    for node in G.nodes():
        in_deg = G.in_degree(node)
        out_deg = G.out_degree(node)
        total_txn = in_deg + out_deg

        if total_txn == 0: continue

        flow_ratio = out_deg / (in_deg + 1)
        unique_counterparties = len(set(list(G.predecessors(node)) + list(G.successors(node))))
        diversity_ratio = unique_counterparties / total_txn

        incoming_times = [data['timestamp'] for _, _, data in G.in_edges(node, data=True)]
        outgoing_times = [data['timestamp'] for _, _, data in G.out_edges(node, data=True)]

        holding_score = 0
        if incoming_times and outgoing_times:
            avg_in = np.mean([t.timestamp() for t in incoming_times])
            avg_out = np.mean([t.timestamp() for t in outgoing_times])
            if (avg_out - avg_in) < 3600: holding_score = 1

        amounts = [data['amount'] for _, _, data in G.in_edges(node, data=True)] + [data['amount'] for _, _, data in G.out_edges(node, data=True)]
        amount_score = 1 if len(amounts) > 1 and np.var(amounts) < 100 else 0

        if in_deg > 10 and out_deg < 3 and diversity_ratio > 0.8: continue

        if node not in suspicious_accounts:
            suspicious_accounts[node] = {"account_id": node, "cycle_score": 0, "temporal_score": 0, "flow_score": 0, "diversity_score": 0, "amount_score": 0, "ring_id": "None"}

        suspicious_accounts[node]["temporal_score"] = holding_score
        suspicious_accounts[node]["flow_score"] = 1 if flow_ratio > 1 else 0
        suspicious_accounts[node]["diversity_score"] = 1 if diversity_ratio < 0.5 else 0
        suspicious_accounts[node]["amount_score"] = amount_score

    # Final scoring
    final_accounts = []
    for acc in suspicious_accounts.values():
        risk_score = (
            0.30 * acc["cycle_score"] +
            0.25 * acc["temporal_score"] +
            0.20 * acc["flow_score"] +
            0.15 * acc["diversity_score"] +
            0.10 * acc["amount_score"]
        ) * 100

        if risk_score > 30:
            acc["suspicion_score"] = round(risk_score, 2)
            acc["detected_patterns"] = [k.replace("_score", "") for k, v in acc.items() if "_score" in k and v == 1]
            
            # Add AI Narrative
            narrative, stage = generate_ai_narrative(acc["account_id"], acc["suspicion_score"], acc["detected_patterns"])
            acc["ai_narrative"] = narrative
            acc["lifecycle_stage"] = stage
            
            final_accounts.append(acc)

    final_accounts = sorted(final_accounts, key=lambda x: x["suspicion_score"], reverse=True)
    sus_ids = {a["account_id"]: a for a in final_accounts}
    processing_time = round(time.time() - start_time, 2)

    analysis_result = {
        "suspicious_accounts": final_accounts,
        "fraud_rings": fraud_rings,
        "summary": {
            "total_accounts_analyzed": len(G.nodes()),
            "suspicious_accounts_flagged": len(final_accounts),
            "fraud_rings_detected": len(fraud_rings),
            "processing_time_seconds": processing_time
        }
    }

    # Prepare Graph Data with colors based on risk
    nodes_data = []
    for n in G.nodes():
        if n in sus_ids:
            score = sus_ids[n]["suspicion_score"]
            color = "#ef4444" if score > 80 else "#f59e0b"
            size = 35 if score > 80 else 25
        else:
            color = "#476957"
            size = 15
        nodes_data.append({"id": n, "label": n, "color": color, "size": size, "font": {"color": "#f8fafc"}})

    graph_data = {
        "nodes": nodes_data,
        "edges": [{"from": u, "to": v, "color": {"color": "#ef4444", "opacity": 0.5}} if u in sus_ids else {"from": u, "to": v, "color": {"color": "#334155"}} for u, v in G.edges()]
    }

    collection.insert_one({
        "analysis": analysis_result,
        "graph": graph_data,
        "created_at": time.time()
    })

    return jsonify({"analysis": analysis_result, "graph": graph_data})

@app.route('/history')
def history():
    data = list(collection.find().sort("created_at", -1))
    for item in data:
        item["_id"] = str(item["_id"])
    return jsonify(data)

@app.route('/history/<id>')
def get_history_item(id):
    from bson import ObjectId
    item = collection.find_one({"_id": ObjectId(id)})
    if not item: return jsonify({"error": "Not found"}), 404
    item["_id"] = str(item["_id"])
    return jsonify(item)

@app.route('/download')
def download():
    global analysis_result
    if not analysis_result: return "No data available"
    json_data = json.dumps(analysis_result, indent=4)
    buffer = io.BytesIO()
    buffer.write(json_data.encode())
    buffer.seek(0)
    return send_file(buffer, as_attachment=True, download_name="fraud_detection_output.json", mimetype="application/json")

if __name__ == "__main__":
    app.run(debug=True)