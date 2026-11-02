import json, sys, re, collections
STATES="AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()
ST={"enacted","partial","pending","none","unclear"}
bad=0
def err(*a):
    global bad; bad+=1; print("ERR",*a)
for area in sys.argv[1:]:
    try: d=json.load(open(f"{area}.json"))
    except Exception as e: err(area,"unreadable",e); continue
    c=d["cells"]
    if set(c)!=set(STATES): err(area,"keys",set(STATES)^set(c))
    cnt=collections.Counter()
    for k,v in c.items():
        cnt[v["s"]]+=1
        if v["s"] not in ST: err(area,k,"status",v["s"])
        if len(v.get("t",""))>120: err(area,k,"t too long",len(v["t"]))
        if len(v.get("q",""))>200: err(area,k,"q too long")
        if len(v.get("x",""))>220: err(area,k,"x too long",len(v["x"]))
        if v["s"]!="none" and not v.get("src"): err(area,k,"no src")
        for s in v.get("src",[]):
            if not re.match(r"https://",s.get("u","")): err(area,k,"bad url",s.get("u"))
            if len(s.get("n",""))>90: err(area,k,"src name long")
    print(area,d.get("asOf"),dict(cnt),"method",len(d.get("method","")),"notes",len(d.get("notes",[])))
print("problems:",bad)
