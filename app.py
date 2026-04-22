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
import traceback
from bson import json_util
from bson.objectid import ObjectId

# =========================
# ENV + MONGODB
# =========================
load_dotenv()

client = MongoClient(os.getenv("MONGO_URI"))
db = client["Finforensics"]
collection = db["analysis"]

app = Flask(__name__)
analysis_result = None

def generate_ai_narrative(account_id, score, patterns):
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
    
    return str(narrative), str(stage)

@app.route('/')
def home():
    return render_template("index.html")

@app.route('/upload', methods=['POST'])
def upload():
    global analysis_result
    start_time = time.time()

    try:
        file = request.files['file']
        
        # CRITICAL FIX 1: Robust CSV Reading (ignores bad lines, fixes spaces in headers)
        df = pd.read_csv(file, on_bad_lines='skip')
        df.columns = [str(c).strip().lower() for c in df.columns] # Removes hidden spaces
        
        # Verify columns exist
        required_cols = ['sender_id', 'receiver_id', 'amount', 'timestamp']
        for col in required_cols:
            if col not in df.columns:
                return jsonify({"error": f"Missing column: '{col}'. Your columns are: {list(df.columns)}"}), 400

        df.dropna(subset=['sender_id', 'receiver_id', 'amount'], inplace=True)
        df['sender_id'] = df['sender_id'].astype(str)
        df['receiver_id'] = df['receiver_id'].astype(str)
        df['amount'] = pd.to_numeric(df['amount'], errors='coerce').fillna(0.0)
        df['timestamp'] = pd.to_datetime(df['timestamp'], errors='coerce')

        G = nx.DiGraph()
        for _, row in df.iterrows():
            if pd.notna(row['timestamp']):
                G.add_edge(str(row['sender_id']), str(row['receiver_id']), amount=float(row['amount']), timestamp=row['timestamp'])

        if len(G.nodes()) == 0:
            return jsonify({"error": "Graph is empty. Check your CSV data format."}), 400

        suspicious_accounts = {}
        fraud_rings = []
        ring_counter = 1

        try:
            cycles = list(nx.simple_cycles(G, length_bound=5))
        except TypeError:
            cycles = []
            for u in G.nodes():
                for v in G.successors(u):
                    for w in G.successors(v):
                        if G.has_edge(w, u):
                            cycles.append([u, v, w])
            cycles = [list(x) for x in set(tuple(sorted(c)) for c in cycles)]

        for cycle in cycles:
            if 3 <= len(cycle) <= 6:
                ring_id = f"RING_{ring_counter:03d}"
                ring_counter += 1
                safe_cycle = [str(node) for node in cycle]
                
                fraud_rings.append({
                    "ring_id": str(ring_id),
                    "member_accounts": safe_cycle,
                    "pattern_type": "cycle",
                    "risk_score": 95.0
                })
                for acc in safe_cycle:
                    if acc not in suspicious_accounts:
                        suspicious_accounts[acc] = {"account_id": acc, "cycle_score": 0, "temporal_score": 0, "flow_score": 0, "diversity_score": 0, "amount_score": 0, "ring_id": ring_id}
                    suspicious_accounts[acc]["cycle_score"] = 1

        for node in G.nodes():
            node_str = str(node)
            in_deg = G.in_degree(node)
            out_deg = G.out_degree(node)
            total_txn = in_deg + out_deg

            if total_txn == 0: continue

            flow_ratio = float(out_deg / (in_deg + 1))
            unique_counterparties = len(set(list(G.predecessors(node)) + list(G.successors(node))))
            diversity_ratio = float(unique_counterparties / total_txn)

            incoming_times = [data['timestamp'] for _, _, data in G.in_edges(node, data=True)]
            outgoing_times = [data['timestamp'] for _, _, data in G.out_edges(node, data=True)]

            holding_score = 0
            if incoming_times and outgoing_times:
                avg_in = float(np.mean([t.timestamp() for t in incoming_times]))
                avg_out = float(np.mean([t.timestamp() for t in outgoing_times]))
                if (avg_out - avg_in) < 3600: holding_score = 1

            amounts = [float(data['amount']) for _, _, data in G.in_edges(node, data=True)] + [float(data['amount']) for _, _, data in G.out_edges(node, data=True)]
            amount_score = 1 if len(amounts) > 1 and float(np.var(amounts)) < 100 else 0

            if in_deg > 10 and out_deg < 3 and diversity_ratio > 0.8: continue

            if node_str not in suspicious_accounts:
                suspicious_accounts[node_str] = {"account_id": node_str, "cycle_score": 0, "temporal_score": 0, "flow_score": 0, "diversity_score": 0, "amount_score": 0, "ring_id": "None"}

            suspicious_accounts[node_str]["temporal_score"] = holding_score
            suspicious_accounts[node_str]["flow_score"] = 1 if flow_ratio > 1 else 0
            suspicious_accounts[node_str]["diversity_score"] = 1 if diversity_ratio < 0.5 else 0
            suspicious_accounts[node_str]["amount_score"] = amount_score

        final_accounts = []
        for acc in suspicious_accounts.values():
            risk_score = float(0.30 * acc["cycle_score"] + 0.25 * acc["temporal_score"] + 0.20 * acc["flow_score"] + 0.15 * acc["diversity_score"] + 0.10 * acc["amount_score"]) * 100
            if risk_score > 30:
                acc["suspicion_score"] = float(round(risk_score, 2))
                acc["detected_patterns"] = [str(k.replace("_score", "")) for k, v in acc.items() if "_score" in k and v == 1]
                narrative, stage = generate_ai_narrative(acc["account_id"], acc["suspicion_score"], acc["detected_patterns"])
                acc["ai_narrative"] = str(narrative)
                acc["lifecycle_stage"] = str(stage)
                final_accounts.append(acc)

        final_accounts = sorted(final_accounts, key=lambda x: x["suspicion_score"], reverse=True)
        sus_ids = {str(a["account_id"]): a for a in final_accounts} 
        processing_time = float(round(time.time() - start_time, 2))

        analysis_result = {
            "suspicious_accounts": final_accounts,
            "fraud_rings": fraud_rings,
            "summary": {
                "total_accounts_analyzed": int(len(G.nodes())),
                "suspicious_accounts_flagged": int(len(final_accounts)),
                "fraud_rings_detected": int(len(fraud_rings)),
                "processing_time_seconds": processing_time
            }
        }

        nodes_data = []
        for n in G.nodes():
            n_str = str(n)
            score = sus_ids[n_str]["suspicion_score"] if n_str in sus_ids else 0
            color = "#ef4444" if score > 80 else ("#f59e0b" if score > 0 else "#94a3b8")
            size = 35 if score > 80 else (25 if score > 0 else 15)
            nodes_data.append({"id": n_str, "label": n_str, "color": color, "size": size, "font": {"color": "#f8fafc"}})

        graph_data = {
            "nodes": nodes_data,
            "edges": [{"from": str(u), "to": str(v), "color": {"color": "#ef4444", "opacity": 0.8}} if str(u) in sus_ids else {"from": str(u), "to": str(v), "color": {"color": "#64748b", "opacity": 0.4}} for u, v in G.edges()]
        }

        # CRITICAL FIX 2: Guarantee JSON/MongoDB compatibility
        safe_record = json.loads(json.dumps({
            "analysis": analysis_result,
            "graph": graph_data,
            "created_at": time.time()
        }))
        collection.insert_one(safe_record)

        return jsonify({"analysis": analysis_result, "graph": graph_data})
        
    except Exception as e:
        error_msg = str(e)
        print("\n=== CRITICAL BACKEND ERROR ===")
        print(traceback.format_exc())
        print("==============================\n")
        return jsonify({"error": f"Backend Error: {error_msg}"}), 500

@app.route('/history')
def history():
    try:
        data = list(collection.find().sort("created_at", -1))
        parsed_data = json.loads(json_util.dumps(data))
        for item in parsed_data:
            if "_id" in item and "$oid" in item["_id"]:
                item["_id"] = item["_id"]["$oid"]
        return jsonify(parsed_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/history/<id>')
def get_history_item(id):
    try:
        item = collection.find_one({"_id": ObjectId(id)})
        if not item: return jsonify({"error": "Not found"}), 404
        parsed_item = json.loads(json_util.dumps(item))
        if "_id" in parsed_item and "$oid" in parsed_item["_id"]:
            parsed_item["_id"] = parsed_item["_id"]["$oid"]
        return jsonify(parsed_item)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/reset')
def reset_db():
    try:
        collection.delete_many({})
        return "<h1>Success! Database Reset.</h1><a href='/'>Go Back</a>"
    except Exception as e:
        return f"Failed to reset database: {str(e)}"

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