from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from pathlib import Path
from datetime import datetime
import sqlite3, json, secrets, mimetypes, re, time, http.cookies, os

ROOT = Path(__file__).resolve().parent
DB = ROOT / 'data' / 'unique_techno.db'
PORT = int(os.environ.get('PORT', '8010'))
SESSION_TTL = 12 * 60 * 60
CUSTOMER_SESSIONS = {}

def conn():
    c=sqlite3.connect(DB)
    c.row_factory=sqlite3.Row
    return c

def now(): return datetime.now().isoformat(timespec='seconds')

def notify_customer(c, customer_id, title, message, booking_id=None):
    c.execute("INSERT INTO notifications(customer_id,booking_id,title,message,created_at) VALUES(?,?,?,?,?)",(customer_id,booking_id,title,message,now()))

def send_json(h, code, obj, set_cookie=None):
    raw=json.dumps(obj, ensure_ascii=False).encode('utf-8')
    h.send_response(code)
    h.send_header('Content-Type','application/json; charset=utf-8')
    h.send_header('Cache-Control','no-store, no-cache, must-revalidate, max-age=0')
    h.send_header('Pragma','no-cache')
    h.send_header('Expires','0')
    h.send_header('Access-Control-Allow-Origin', h.headers.get('Origin','http://127.0.0.1:8010'))
    h.send_header('Access-Control-Allow-Credentials','true')
    if set_cookie:
        h.send_header('Set-Cookie', set_cookie)
    h.send_header('Content-Length',str(len(raw)))
    h.end_headers(); h.wfile.write(raw)

def get_customer_id_from_session(h):
    raw=h.headers.get('Cookie','')
    jar=http.cookies.SimpleCookie()
    try: jar.load(raw)
    except Exception: return None
    morsel=jar.get('uts_customer_session')
    if not morsel: return None
    token=morsel.value
    item=CUSTOMER_SESSIONS.get(token)
    if not item: return None
    cid, expires=item
    if expires < time.time():
        CUSTOMER_SESSIONS.pop(token,None)
        return None
    return cid

def require_customer(h):
    cid=get_customer_id_from_session(h)
    if not cid:
        send_json(h,401,{'error':'Customer login required','code':'AUTH_REQUIRED'})
        return None
    return cid

def customer_cookie(cid):
    token=secrets.token_urlsafe(32)
    CUSTOMER_SESSIONS[token]=(int(cid),time.time()+SESSION_TTL)
    return f'uts_customer_session={token}; Path=/; Max-Age={SESSION_TTL}; HttpOnly; SameSite=Lax'

def clear_customer_cookie(h):
    raw=h.headers.get('Cookie',''); jar=http.cookies.SimpleCookie()
    try: jar.load(raw)
    except Exception: pass
    m=jar.get('uts_customer_session')
    if m: CUSTOMER_SESSIONS.pop(m.value,None)

def read_json(h):
    try:
        n=int(h.headers.get('Content-Length','0') or 0)
        return json.loads(h.rfile.read(n).decode('utf-8') or '{}')
    except Exception: return {}


def migrate_db():
    c=conn()
    try:
        cols={r[1] for r in c.execute("PRAGMA table_info(bookings)").fetchall()}
        stmts={
            "eta_until":"ALTER TABLE bookings ADD COLUMN eta_until TEXT DEFAULT ''",
            "arrived_at":"ALTER TABLE bookings ADD COLUMN arrived_at TEXT DEFAULT ''",
            "started_at":"ALTER TABLE bookings ADD COLUMN started_at TEXT DEFAULT ''",
            "completed_at":"ALTER TABLE bookings ADD COLUMN completed_at TEXT DEFAULT ''",
            "customer_confirmed_at":"ALTER TABLE bookings ADD COLUMN customer_confirmed_at TEXT DEFAULT ''",
            "closed_at":"ALTER TABLE bookings ADD COLUMN closed_at TEXT DEFAULT ''",
            "payment_status":"ALTER TABLE bookings ADD COLUMN payment_status TEXT DEFAULT 'Unpaid'",
            "payment_id":"ALTER TABLE bookings ADD COLUMN payment_id TEXT DEFAULT ''",
            "payment_utr":"ALTER TABLE bookings ADD COLUMN payment_utr TEXT DEFAULT ''",
            "paid_at":"ALTER TABLE bookings ADD COLUMN paid_at TEXT DEFAULT ''",
            "review_rating":"ALTER TABLE bookings ADD COLUMN review_rating INTEGER DEFAULT 0",
            "review_text":"ALTER TABLE bookings ADD COLUMN review_text TEXT DEFAULT ''",
            "reviewed_at":"ALTER TABLE bookings ADD COLUMN reviewed_at TEXT DEFAULT ''",
            "cancellation_reason":"ALTER TABLE bookings ADD COLUMN cancellation_reason TEXT DEFAULT ''",
        }
        for col,stmt in stmts.items():
            if col not in cols: c.execute(stmt)
        ccols={r[1] for r in c.execute("PRAGMA table_info(customers)").fetchall()}
        for col,stmt in {
            "email":"ALTER TABLE customers ADD COLUMN email TEXT DEFAULT ''",
            "address":"ALTER TABLE customers ADD COLUMN address TEXT DEFAULT ''",
            "pincode":"ALTER TABLE customers ADD COLUMN pincode TEXT DEFAULT ''",
        }.items():
            if col not in ccols: c.execute(stmt)
        bcols={r[1] for r in c.execute('PRAGMA table_info(bookings)').fetchall()}
        if 'offer_id' not in bcols:
            c.execute("ALTER TABLE bookings ADD COLUMN offer_id INTEGER")
        for col,stmt in {
            'engineer_notes':"ALTER TABLE bookings ADD COLUMN engineer_notes TEXT DEFAULT ''",
            'engineer_updated_at':"ALTER TABLE bookings ADD COLUMN engineer_updated_at TEXT DEFAULT ''",
        }.items():
            if col not in bcols: c.execute(stmt)
        ecols={r[1] for r in c.execute("PRAGMA table_info(engineers)").fetchall()}
        if 'engineer_code' not in ecols:
            c.execute("ALTER TABLE engineers ADD COLUMN engineer_code TEXT")
        # Backfill deterministic public IDs for existing engineers.
        existing=c.execute("SELECT id FROM engineers WHERE engineer_code IS NULL OR engineer_code='' ORDER BY id").fetchall()
        for idx,r in enumerate(existing, start=1):
            c.execute("UPDATE engineers SET engineer_code=? WHERE id=?",(f'UTSE-{r[0]}',r[0]))
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_engineers_code ON engineers(engineer_code)")
        c.execute("""CREATE TABLE IF NOT EXISTS offers(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            discount TEXT NOT NULL DEFAULT '',
            price_text TEXT NOT NULL DEFAULT '',
            fixed_price INTEGER NOT NULL DEFAULT 0,
            badge TEXT NOT NULL DEFAULT 'LIMITED OFFER',
            icon TEXT NOT NULL DEFAULT '✦',
            service_id INTEGER,
            valid_until TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""")
        offer_cols={r[1] for r in c.execute('PRAGMA table_info(offers)').fetchall()}
        if 'fixed_price' not in offer_cols:
            c.execute("ALTER TABLE offers ADD COLUMN fixed_price INTEGER NOT NULL DEFAULT 0")
        if c.execute('SELECT COUNT(*) n FROM offers').fetchone()['n']==0:
            seeds=[
                ('CCTV AMC Care','Keep your cameras, DVR/NVR and storage running reliably with a scheduled maintenance visit.','20% OFF','₹1,499','POPULAR','◉',7,1499,'2026-09-30','active'),
                ('Network Health Check','Get a professional check of Wi‑Fi, LAN, switches, cabling and performance issues.','SAVE ₹300','₹499','THIS MONTH','⌁',3,499,'2026-09-20','active'),
                ('Laptop Service Week','Diagnosis, cleanup and performance check for your office or personal laptop.','15% OFF','₹399','LIMITED','▣',4,399,'2026-09-15','active')
            ]
            for title,desc,disc,price,badge,icon,sid,fixed,until,status in seeds:
                c.execute('INSERT INTO offers(title,description,discount,price_text,fixed_price,badge,icon,service_id,valid_until,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(title,desc,disc,price,fixed,badge,icon,sid,until,status,now(),now()))
        c.execute("""CREATE TABLE IF NOT EXISTS notifications(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            booking_id INTEGER,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            is_read INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS offer_activity(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            offer_id INTEGER NOT NULL,
            customer_id INTEGER NOT NULL,
            activity TEXT NOT NULL,
            created_at TEXT NOT NULL
        )""")
        defaults={1:(7,1499,'₹1,499'),2:(3,499,'₹499'),3:(4,399,'₹399')}
        for oid,(sid,fp,pt) in defaults.items():
            c.execute("UPDATE offers SET service_id=COALESCE(service_id,?), fixed_price=CASE WHEN fixed_price<=0 THEN ? ELSE fixed_price END, price_text=CASE WHEN price_text LIKE 'From %' OR price_text='' THEN ? ELSE price_text END WHERE id=?",(sid,fp,pt,oid))
        c.execute("CREATE INDEX IF NOT EXISTS idx_offer_activity_offer ON offer_activity(offer_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_offer_activity_customer ON offer_activity(customer_id)")
        c.commit()
    finally: c.close()

def booking_full(c, value):
    return c.execute("""SELECT b.*,
                               cu.name customer, cu.phone customer_phone, cu.email customer_email,
                               cu.area customer_area, cu.address customer_address,
                               s.name service, s.icon service_icon, s.price service_price,
                               e.name engineer, e.engineer_code engineer_code, e.phone engineer_phone, e.area engineer_area,
                               e.rating engineer_rating, e.status engineer_status, e.skills engineer_skills
                        FROM bookings b
                        JOIN customers cu ON cu.id=b.customer_id
                        JOIN services s ON s.id=b.service_id
                        LEFT JOIN engineers e ON e.id=b.engineer_id
                        WHERE b.booking_code=? OR CAST(b.id AS TEXT)=?""",(str(value),str(value))).fetchone()

def _pdf_escape(text):
    text=str(text or '')
    text=text.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
    return ''.join(ch if 32 <= ord(ch) <= 126 else '?' for ch in text)

def make_invoice_pdf(b):
    """Create a professional, dependency-free invoice PDF with the company logo."""
    from datetime import datetime
    amount=float(b.get('amount') or 0)
    status=str(b.get('payment_status') or 'Unpaid')
    logo_path=ROOT/'static'/'img'/'unique-techno-logo.jpg'
    logo=logo_path.read_bytes() if logo_path.exists() else b''
    # Logo is shipped as a small JPEG (177x180), so no imaging dependency is needed at runtime.
    iw,ih=688,700
    # PDF canvas helpers. Coordinates are points, origin bottom-left.
    ops=[]
    def txt(x,y,text,size=9,font='F1'):
        ops.extend([f'BT /{font} {size} Tf 1 0 0 1 {x:.1f} {y:.1f} Tm ({_pdf_escape(text)}) Tj ET'])
    def line(x1,y1,x2,y2,w=1): ops.extend([f'{w} w {x1} {y1} m {x2} {y2} l S'])
    def rect(x,y,w,h,stroke=True,fill=False):
        ops.append(f'{x} {y} {w} {h} re ' + ('B' if stroke and fill else 'S' if stroke else 'f'))
    def fillgray(g): ops.append(f'{g} g')
    def setrgb(r,g,bv): ops.append(f'{r} {g} {bv} rg')
    def wrap(text,n=72):
        words=str(text or '-').split(); lines=[]; cur=''
        for w in words:
            if len(cur)+len(w)+(1 if cur else 0)<=n: cur=(cur+' '+w).strip()
            else: lines.append(cur); cur=w
        if cur or not lines: lines.append(cur or '-')
        return lines

    # Header
    setrgb(.03,.20,.32); rect(0,780,595,62,False,True)
    if logo:
        ops.append('q 76 0 0 76 34 773 cm /Im1 Do Q')
    setrgb(1,1,1); txt(126,814,'UNIQUE TECHNO SOLUTIONS',18,'F2'); txt(126,798,'Professional IT • CCTV • Networking • Automation Services',8,'F1')
    setrgb(.03,.20,.32); txt(430,814,'INVOICE',18,'F2'); txt(430,798,'SERVICE RECEIPT',8,'F1')

    # Invoice meta
    setrgb(0,0,0); txt(42,752,'Invoice / Booking ID',8,'F2'); txt(42,738,str(b.get('booking_code') or '-'),11,'F2')
    txt(420,752,'Invoice Date',8,'F2'); txt(420,738,datetime.now().strftime('%d-%m-%Y'),10,'F1')
    line(42,724,553,724,.8)

    # Bill to / service summary boxes
    fillgray(.97); rect(42,625,245,82,True,True); rect(308,625,245,82,True,True); fillgray(0)
    txt(55,690,'BILL TO',8,'F2'); txt(55,674,str(b.get('customer') or '-'),11,'F2'); txt(55,658,'Phone: '+str(b.get('customer_phone') or '-'),8); 
    addr_lines=wrap(b.get('address') or '-',42)[:2]
    txt(55,642,'Address: '+addr_lines[0],8)
    if len(addr_lines)>1: txt(55,630,addr_lines[1],8)
    txt(321,690,'SERVICE DETAILS',8,'F2'); txt(321,674,str(b.get('service') or '-'),11,'F2'); txt(321,658,'Date & Time: '+str((b.get('date') or '-')+' '+(b.get('time') or '')),8); txt(321,642,'Engineer: '+str(b.get('engineer') or 'Not assigned'),8); txt(321,630,'Status: '+str(b.get('status') or '-'),8)

    # Service table
    ytop=590; setrgb(.03,.20,.32); rect(42,ytop-28,511,28,False,True); setrgb(1,1,1)
    txt(55,ytop-18,'DESCRIPTION',8,'F2'); txt(450,ytop-18,'AMOUNT',8,'F2')
    setrgb(0,0,0); rect(42,ytop-72,511,44,True,False); txt(55,ytop-48,str(b.get('service') or 'Service charge'),9,'F2'); txt(55,ytop-62,'Completed service',8); txt(450,ytop-50,'INR '+format(amount,',.2f'),9,'F2')

    # Payment summary
    fillgray(.97); rect(42,405,511,86,True,True); fillgray(0)
    txt(55,470,'PAYMENT INFORMATION',8,'F2'); txt(55,450,'Payment Status',8); txt(180,450,status,9,'F2')
    if b.get('payment_id'): txt(55,434,'Payment Reference',8); txt(180,434,str(b.get('payment_id')),9,'F2')
    if b.get('payment_utr'): txt(350,450,'UTR / Transaction ID',8); txt(455,450,str(b.get('payment_utr')),8,'F2')
    if b.get('paid_at'): txt(350,434,'Paid At',8); txt(455,434,str(b.get('paid_at')),8,'F1')

    # Total box
    setrgb(.03,.20,.32); rect(342,350,211,42,False,True); setrgb(1,1,1); txt(360,376,'TOTAL SERVICE CHARGE',8,'F2'); txt(360,359,'INR '+format(amount,',.2f'),15,'F2')
    setrgb(0,0,0); txt(42,375,'Thank you for choosing Unique Techno Solutions.',10,'F2'); txt(42,357,'This is a computer-generated service invoice.',8,'F1')
    line(42,82,553,82,.7); txt(42,62,'Unique Techno Solutions',8,'F2'); txt(42,48,'Professional IT & CCTV Services',7,'F1'); txt(430,62,'Thank you for your business.',8,'F2')

    stream=('q\n'+'\n'.join(ops)+'\nQ\n').encode('ascii')
    # Objects: catalog, pages, page, content, fonts, image, xobject resources are in page.
    objs=[
      b'<< /Type /Catalog /Pages 2 0 R >>',
      b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /XObject << /Im1 7 0 R >> >> /Contents 4 0 R >>',
      b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'endstream',
      b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
      b'<< /Type /XObject /Subtype /Image /Width '+str(iw).encode()+b' /Height '+str(ih).encode()+b' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+str(len(logo)).encode()+b' >>\nstream\n'+logo+b'\nendstream'
    ]
    pdf=bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'); offsets=[]
    for i,obj in enumerate(objs,1):
        offsets.append(len(pdf)); pdf.extend(f'{i} 0 obj\n'.encode()); pdf.extend(obj); pdf.extend(b'\nendobj\n')
    xref=len(pdf); pdf.extend(f'xref\n0 {len(objs)+1}\n'.encode()); pdf.extend(b'0000000000 65535 f \n')
    for off in offsets: pdf.extend(f'{off:010d} 00000 n \n'.encode())
    pdf.extend(f'trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return bytes(pdf)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_OPTIONS(self):
        self.send_response(204); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS'); self.send_header('Access-Control-Allow-Headers','Content-Type'); self.end_headers()
    def static(self, rel):
        p=ROOT/rel.lstrip('/')
        if not p.exists() or not p.is_file(): self.send_error(404); return
        raw=p.read_bytes(); ct=mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
        self.send_response(200); self.send_header('Content-Type',ct); self.send_header('Content-Length',str(len(raw))); self.send_header('Cache-Control','no-store, no-cache, must-revalidate, max-age=0'); self.send_header('Pragma','no-cache'); self.send_header('Expires','0'); self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        p=urlparse(self.path).path; c=conn()
        try:
            if p=='/': self.send_response(302); self.send_header('Location','/customer/'); self.end_headers(); return
            if p=='/customer/':
                if not get_customer_id_from_session(self):
                    self.send_response(302); self.send_header('Location','/customer/login'); self.end_headers(); return
                return self.static('customer/index.html')
            if p=='/customer/login': return self.static('customer/index.html')
            if p=='/engineer/': return self.static('engineer/index.html')
            if p in ('/admin/','/admin.html'): return self.static('admin/index.html')
            if p.startswith('/static/'): return self.static(p[1:])
            if p=='/api/customer/session':
                cid=require_customer(self)
                if not cid: return
                r=c.execute('SELECT * FROM customers WHERE id=?',(cid,)).fetchone()
                if not r: return send_json(self,401,{'error':'Customer account not found'})
                return send_json(self,200,{'customer':dict(r)})
            if p=='/api/services':
                return send_json(self,200,[dict(r) for r in c.execute("SELECT * FROM services WHERE status='active' ORDER BY id").fetchall()])
            if p.startswith('/api/customer/') and p.endswith('/bookings'):
                session_cid=require_customer(self)
                if not session_cid: return

                try:
                    cid=int(p.split('/')[3])
                except Exception:
                    return send_json(self,400,{'error':'Invalid customer id'})
                if cid != session_cid: return send_json(self,403,{'error':'Customer access denied'})
                rows=c.execute('''SELECT b.id,b.booking_code,b.date,b.time,b.address,b.problem,b.amount,b.status,b.engineer_id,b.created_at,b.payment_status,b.payment_id,b.payment_utr,b.paid_at,b.review_rating,b.review_text,b.reviewed_at,b.cancellation_reason,
                                         s.name service,s.icon service_icon,
                                         e.name engineer,e.phone engineer_phone,e.area engineer_area,e.rating engineer_rating,
                                         e.status engineer_status,e.skills engineer_skills,
                                         b.offer_id, o.title offer_title, o.fixed_price offer_price
                                  FROM bookings b
                                  JOIN services s ON s.id=b.service_id
                                  LEFT JOIN engineers e ON e.id=b.engineer_id
                                  LEFT JOIN offers o ON o.id=b.offer_id
                                  WHERE b.customer_id=?
                                  ORDER BY b.id DESC''',(cid,)).fetchall()
                return send_json(self,200,[dict(r) for r in rows])
            if p.startswith('/api/customer/') and p.endswith('/addresses'):
                session_cid=require_customer(self)
                if not session_cid: return
                try: cid=int(p.split('/')[3])
                except Exception: return send_json(self,400,{'error':'Invalid customer id'})
                if cid != session_cid: return send_json(self,403,{'error':'Customer access denied'})
                c.execute('''CREATE TABLE IF NOT EXISTS customer_addresses(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER NOT NULL,label TEXT NOT NULL DEFAULT 'Default Address',area TEXT DEFAULT '',pincode TEXT DEFAULT '',address TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,is_default INTEGER NOT NULL DEFAULT 0)''')
                rows=[dict(x) for x in c.execute('SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC,id DESC',(cid,)).fetchall()]
                if not rows:
                    r=c.execute('SELECT * FROM customers WHERE id=?',(cid,)).fetchone()
                    if r and (r['address'] or r['area']):
                        nowv=now(); c.execute("INSERT INTO customer_addresses(customer_id,label,area,pincode,address,created_at,updated_at,is_default) VALUES(?,?,?,?,?,?,?,1)",(cid,'Default Address',r['area'] or '', '',r['address'] or '',nowv,nowv)); c.commit(); rows=[dict(x) for x in c.execute('SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC,id DESC',(cid,)).fetchall()]
                return send_json(self,200,rows)
            if p.startswith('/api/customer/') and p.endswith('/profile'):
                session_cid=require_customer(self)
                if not session_cid: return

                try: cid=int(p.split('/')[3])
                except Exception: return send_json(self,400,{'error':'Invalid customer id'})
                if cid != session_cid: return send_json(self,403,{'error':'Customer access denied'})
                r=c.execute('SELECT * FROM customers WHERE id=?',(cid,)).fetchone()
                if not r:return send_json(self,404,{'error':'Customer not found'})
                return send_json(self,200,dict(r))
            if p.startswith('/api/customer/') and p.endswith('/notifications'):
                session_cid=require_customer(self)
                if not session_cid: return

                try: cid=int(p.split('/')[3])
                except Exception: return send_json(self,400,{'error':'Invalid customer id'})
                if cid != session_cid: return send_json(self,403,{'error':'Customer access denied'})
                rows=c.execute('SELECT * FROM notifications WHERE customer_id=? ORDER BY id DESC LIMIT 50',(cid,)).fetchall()
                return send_json(self,200,[dict(r) for r in rows])

            if p.startswith('/api/customer/') and p.endswith('/support'):
                session_cid=require_customer(self)
                if not session_cid: return

                try: cid=int(p.split('/')[3])
                except Exception: return send_json(self,400,{'error':'Invalid customer id'})
                if cid != session_cid: return send_json(self,403,{'error':'Customer access denied'})
                rows=c.execute('SELECT t.*,b.booking_code FROM support_tickets t LEFT JOIN bookings b ON b.id=t.booking_id WHERE t.customer_id=? ORDER BY t.id DESC',(cid,)).fetchall()
                return send_json(self,200,[dict(r) for r in rows])

            if p.startswith('/api/engineers/') and p.endswith('/profile'):
                key=p.split('/')[3]
                r=c.execute('SELECT * FROM engineers WHERE engineer_code=? AND active=1',(key,)).fetchone()
                if not r:
                    try: r=c.execute('SELECT * FROM engineers WHERE id=? AND active=1',(int(key),)).fetchone()
                    except Exception: r=None
                if not r:return send_json(self,404,{'error':'Engineer not found'})
                return send_json(self,200,dict(r))
            if p.startswith('/api/engineers/') and p.endswith('/jobs'):
                key=p.split('/')[3]
                e=c.execute('SELECT * FROM engineers WHERE engineer_code=? AND active=1',(key,)).fetchone()
                if not e:
                    try: e=c.execute('SELECT * FROM engineers WHERE id=? AND active=1',(int(key),)).fetchone()
                    except Exception: e=None
                eid=e['id'] if e else 0
                if not e:return send_json(self,404,{'error':'Engineer not found'})
                rows=c.execute("SELECT b.*,cu.name customer,cu.phone customer_phone,cu.email customer_email,cu.area customer_area,cu.address customer_address,s.name service,s.icon service_icon FROM bookings b JOIN customers cu ON cu.id=b.customer_id JOIN services s ON s.id=b.service_id WHERE b.engineer_id=? ORDER BY CASE WHEN b.status IN ('Assigned','On the Way','Arrived','Service Started') THEN 0 ELSE 1 END,b.date ASC,b.time ASC,b.id DESC",(eid,)).fetchall()
                return send_json(self,200,[dict(r) for r in rows])

            if p=='/api/offers':
                today=datetime.now().date().isoformat()
                rows=c.execute("SELECT o.*,s.name service_name FROM offers o LEFT JOIN services s ON s.id=o.service_id WHERE o.status='active' AND (o.valid_until='' OR o.valid_until>=?) ORDER BY o.id DESC",(today,)).fetchall()
                return send_json(self,200,[dict(r) for r in rows])
            if p=='/api/admin/offers':
                rows=c.execute('''SELECT o.*,
                    (SELECT COUNT(*) FROM offer_activity a WHERE a.offer_id=o.id AND a.activity='view') AS views,
                    (SELECT COUNT(*) FROM offer_activity a WHERE a.offer_id=o.id AND a.activity='explore') AS explores,
                    (SELECT COUNT(*) FROM offer_activity a WHERE a.offer_id=o.id AND a.activity='book') AS bookings
                    FROM offers o ORDER BY o.id DESC''').fetchall()
                return send_json(self,200,[dict(r) for r in rows])
            if p=='/api/admin/offers/activity':
                rows=c.execute("SELECT a.id,a.offer_id,a.customer_id,a.activity,a.created_at,o.title,cu.name customer,cu.phone customer_phone FROM offer_activity a JOIN offers o ON o.id=a.offer_id JOIN customers cu ON cu.id=a.customer_id ORDER BY a.id DESC LIMIT 100").fetchall()
                return send_json(self,200,{'activities':[dict(r) for r in rows]})
            if p=='/api/admin/reviews':
                rows=c.execute('''SELECT b.booking_code,b.date,b.created_at,b.review_rating,b.review_text,b.reviewed_at,
                                         cu.name customer,cu.phone customer_phone,s.name service,
                                         e.name engineer
                                  FROM bookings b
                                  JOIN customers cu ON cu.id=b.customer_id
                                  JOIN services s ON s.id=b.service_id
                                  LEFT JOIN engineers e ON e.id=b.engineer_id
                                  WHERE b.review_rating>0
                                  ORDER BY COALESCE(b.reviewed_at,b.created_at) DESC''').fetchall()
                return send_json(self,200,[dict(r) for r in rows])

            if p.startswith('/api/bookings/') and p.endswith('/invoice'):
                cid=require_customer(self)
                if not cid: return
                value=p.split('/')[3]
                b=booking_full(c,value)
                if not b:return send_json(self,404,{'error':'Booking not found'})
                if b['customer_id']!=cid:return send_json(self,403,{'error':'Customer mismatch'})
                if b['status'] not in ('Completed','Closed'):
                    return send_json(self,409,{'error':'Invoice is available after service completion'})
                try:
                    raw=make_invoice_pdf(dict(b))
                except Exception as exc:
                    return send_json(self,500,{'error':f'Invoice generation failed: {exc}'})
                if not raw:
                    return send_json(self,500,{'error':'Invoice generation returned an empty PDF'})
                self.send_response(200)
                self.send_header('Content-Type','application/pdf')
                self.send_header('Content-Disposition',f'attachment; filename="Unique-Techno-Invoice-{b["booking_code"]}.pdf"')
                self.send_header('Cache-Control','no-store, no-cache, must-revalidate, max-age=0')
                self.send_header('Content-Length',str(len(raw)))
                self.send_header('Connection','close')
                self.end_headers(); self.wfile.write(raw); return
            if p.startswith('/api/bookings/'):
                r=booking_full(c,p.rsplit('/',1)[1])
                return send_json(self,200,dict(r)) if r else send_json(self,404,{'error':'Booking not found'})
            if p=='/api/admin/overview':
                services=[dict(r) for r in c.execute('SELECT * FROM services ORDER BY id').fetchall()]
                bookings=[dict(r) for r in c.execute('''SELECT b.*,cu.name customer,cu.phone,cu.area customer_area,s.name service,
                         e.name engineer,e.phone engineer_phone,e.area engineer_area,e.rating engineer_rating,e.status engineer_status,
                         o.title offer_title,o.fixed_price offer_price
                         FROM bookings b JOIN customers cu ON cu.id=b.customer_id JOIN services s ON s.id=b.service_id LEFT JOIN engineers e ON e.id=b.engineer_id LEFT JOIN offers o ON o.id=b.offer_id ORDER BY b.id DESC''').fetchall()]
                customers=[dict(r) for r in c.execute('''SELECT cu.*,COUNT(b.id) bookings,COALESCE(SUM(CASE WHEN b.status!='Cancelled' THEN b.amount ELSE 0 END),0) spend
                         FROM customers cu LEFT JOIN bookings b ON b.customer_id=cu.id GROUP BY cu.id ORDER BY cu.id DESC''').fetchall()]
                engineers=[dict(r) for r in c.execute('''SELECT e.*,COUNT(CASE WHEN date(b.created_at)=date('now') THEN 1 END) today_jobs,
                         COUNT(CASE WHEN b.status='Completed' THEN 1 END) completed_jobs,COUNT(CASE WHEN b.status IN ('Assigned','On the Way') THEN 1 END) active_jobs
                         FROM engineers e LEFT JOIN bookings b ON b.engineer_id=e.id GROUP BY e.id ORDER BY e.id''').fetchall()]
                offers=[dict(r) for r in c.execute("SELECT o.*,s.name service_name,(SELECT COUNT(*) FROM offer_activity a WHERE a.offer_id=o.id AND a.activity='view') views,(SELECT COUNT(*) FROM offer_activity a WHERE a.offer_id=o.id AND a.activity='explore') explores,(SELECT COUNT(*) FROM offer_activity a WHERE a.offer_id=o.id AND a.activity='book') bookings FROM offers o LEFT JOIN services s ON s.id=o.service_id ORDER BY o.id DESC").fetchall()]
                return send_json(self,200,{'services':services,'bookings':bookings,'customers':customers,'engineers':engineers,'offers':offers})
            self.send_error(404)
        finally:c.close()
    def do_POST(self):
        p=urlparse(self.path).path; d=read_json(self); c=conn()
        try:
            if p=='/api/customer/check-phone':
                phone=re.sub(r'\D','',str(d.get('phone','')))[-10:]
                if len(phone)!=10: return send_json(self,400,{'error':'Valid 10-digit phone required'})
                r=c.execute('SELECT id FROM customers WHERE phone=?',(phone,)).fetchone()
                return send_json(self,200,{'exists':bool(r)})
            if p=='/api/customer/login':
                if str(d.get('otp','')) != '123456': return send_json(self,401,{'error':'Invalid OTP'})
                phone=re.sub(r'\D','',str(d.get('phone','')))[-10:]
                if len(phone)!=10: return send_json(self,400,{'error':'Valid 10-digit phone required'})
                r=c.execute('SELECT * FROM customers WHERE phone=?',(phone,)).fetchone()
                if not r: return send_json(self,404,{'error':'No account found for this mobile number. Please Sign Up first.','code':'CUSTOMER_NOT_FOUND'})
                cid=r['id']
                return send_json(self,200,{'customer':dict(r)}, set_cookie=customer_cookie(cid))
            if p=='/api/customer/signup':
                if str(d.get('otp','')) != '123456': return send_json(self,401,{'error':'Invalid OTP'})
                phone=re.sub(r'\D','',str(d.get('phone','')))[-10:]
                name=str(d.get('name','')).strip()
                email=str(d.get('email','')).strip().lower()
                area=str(d.get('area','')).strip()
                pincode=str(d.get('pincode','')).strip()
                address=str(d.get('address','')).strip()
                if len(phone)!=10: return send_json(self,400,{'error':'Valid 10-digit phone required'})
                if len(name)<2: return send_json(self,400,{'error':'Full name is required'})
                if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$',email): return send_json(self,400,{'error':'Valid email address is required'})
                if not area: return send_json(self,400,{'error':'Area is required'})
                if not re.match(r'^\d{6}$',pincode): return send_json(self,400,{'error':'Valid 6-digit pincode is required'})
                if len(address)<8: return send_json(self,400,{'error':'Complete service address is required'})
                existing=c.execute('SELECT id FROM customers WHERE phone=?',(phone,)).fetchone()
                if existing: return send_json(self,409,{'error':'An account already exists with this mobile number. Please Login instead.','code':'CUSTOMER_EXISTS'})
                cur=c.execute('INSERT INTO customers(name,phone,area,email,address,pincode,created_at) VALUES(?,?,?,?,?,?,?)',(name,phone,area,email,address,pincode,now()))
                cid=cur.lastrowid;c.commit()
                return send_json(self,201,{'customer':dict(c.execute('SELECT * FROM customers WHERE id=?',(cid,)).fetchone())}, set_cookie=customer_cookie(cid))
            if p.startswith('/api/customer/') and p.endswith('/addresses'):
                session_cid=require_customer(self)
                if not session_cid: return
                try: cid=int(p.split('/')[3])
                except Exception: return send_json(self,400,{'error':'Invalid customer id'})
                if cid != session_cid: return send_json(self,403,{'error':'Customer access denied'})
                c.execute('''CREATE TABLE IF NOT EXISTS customer_addresses(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER NOT NULL,label TEXT NOT NULL DEFAULT 'Default Address',area TEXT DEFAULT '',pincode TEXT DEFAULT '',address TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,is_default INTEGER NOT NULL DEFAULT 0)''')
                address=str(d.get('address','')).strip(); area=str(d.get('area','')).strip(); pincode=str(d.get('pincode','')).strip(); label=str(d.get('label','Default Address')).strip() or 'Address'; is_default=1 if d.get('is_default') else 0
                if not address:return send_json(self,400,{'error':'Full address is required'})
                if pincode and not pincode.isdigit() or (pincode and len(pincode)!=6):return send_json(self,400,{'error':'Enter a valid 6-digit pincode'})
                if is_default:c.execute('UPDATE customer_addresses SET is_default=0 WHERE customer_id=?',(cid,))
                nowv=now(); cur=c.execute("INSERT INTO customer_addresses(customer_id,label,area,pincode,address,created_at,updated_at,is_default) VALUES(?,?,?,?,?,?,?,?)",(cid,label,area,pincode,address,nowv,nowv,is_default)); c.commit(); return send_json(self,200,dict(c.execute('SELECT * FROM customer_addresses WHERE id=?',(cur.lastrowid,)).fetchone()))
            if p.startswith('/api/customer/') and p.endswith('/profile-change-otp'):
                session_cid=require_customer(self)
                if not session_cid: return
                try: cid=int(p.split('/')[3])
                except Exception: return send_json(self,400,{'error':'Invalid customer id'})
                if cid != session_cid: return send_json(self,403,{'error':'Customer access denied'})
                r=c.execute('SELECT * FROM customers WHERE id=?',(cid,)).fetchone()
                if not r:return send_json(self,404,{'error':'Customer not found'})
                typ=str(d.get('type','')).strip().lower(); value=str(d.get('value','')).strip()
                if typ not in ('email','mobile'): return send_json(self,400,{'error':'Invalid change type'})
                if typ=='email':
                    if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$',value): return send_json(self,400,{'error':'Enter a valid email address.'})
                    other=c.execute('SELECT id FROM customers WHERE lower(email)=lower(?) AND id<>?',(value,cid)).fetchone()
                    if other:return send_json(self,409,{'error':'This email is already registered with another account.'})
                else:
                    value=re.sub(r'\D','',value)[-10:]
                    if len(value)!=10:return send_json(self,400,{'error':'Enter a valid 10-digit mobile number.'})
                    other=c.execute('SELECT id FROM customers WHERE phone=? AND id<>?',(value,cid)).fetchone()
                    if other:return send_json(self,409,{'error':'This mobile number is already registered with another account.'})
                return send_json(self,200,{'sent':True,'message':'OTP sent to your registered mobile number.','otp_demo':'123456'})
            if p=='/api/customer/logout':
                clear_customer_cookie(self)
                return send_json(self,200,{'ok':True}, set_cookie='uts_customer_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
            if re.match(r'^/api/customer/\\d+/notifications/read-all$',p):
                session_cid=require_customer(self)
                if not session_cid:return
                cid=int(p.strip('/').split('/')[2])
                if cid!=session_cid:return send_json(self,403,{'error':'Customer access denied'})
                c.execute('UPDATE notifications SET is_read=1 WHERE customer_id=?',(cid,));c.commit()
                return send_json(self,200,{'ok':True})
            if re.match(r'^/api/customer/\\d+/notifications/\\d+/read$',p):
                session_cid=require_customer(self)
                if not session_cid:return
                parts=p.strip('/').split('/');cid=int(parts[2]);nid=int(parts[4])
                if cid!=session_cid:return send_json(self,403,{'error':'Customer access denied'})
                c.execute('UPDATE notifications SET is_read=1 WHERE id=? AND customer_id=?',(nid,cid));c.commit()
                return send_json(self,200,{'ok':True})
            if p=='/api/bookings':
                # Resolve the logged-in customer first; keep a safe fallback for the
                # customer_id/phone sent by the customer UI so regular services and
                # offer bookings use the exact same booking path.
                cid=require_customer(self)
                if not cid and d.get('customer_id'):
                    try:
                        candidate=int(d.get('customer_id'))
                        if c.execute('SELECT id FROM customers WHERE id=?',(candidate,)).fetchone():
                            cid=candidate
                    except Exception:
                        pass
                if not cid and d.get('phone'):
                    phone=re.sub(r'\D','',str(d.get('phone','')))[-10:]
                    rr=c.execute('SELECT id FROM customers WHERE phone=?',(phone,)).fetchone(); cid=rr['id'] if rr else None
                if not cid: return send_json(self,401,{'error':'Customer login required. Please login again.'})
                sid=int(d.get('service_id',0) or 0); s=c.execute("SELECT * FROM services WHERE id=? AND status='active'",(sid,)).fetchone()
                offer_id=int(d.get('offer_id',0) or 0); offer=None
                if offer_id:
                    today=datetime.now().date().isoformat()
                    offer=c.execute("SELECT * FROM offers WHERE id=? AND status='active' AND (valid_until='' OR valid_until>=?)",(offer_id,today)).fetchone()
                    if not offer:return send_json(self,409,{'error':'Offer is no longer available'})
                    if offer['service_id'] and int(offer['service_id'])!=sid:return send_json(self,409,{'error':'Offer service mismatch'})
                if not cid or not s: return send_json(self,400,{'error':'Customer and active service required'})
                amount=int(offer['fixed_price']) if offer and int(offer['fixed_price'] or 0)>0 else int(s['price'])
                # Human-readable booking ID: UTSBID-YYYYMMDD-serial (serial resets daily).
                day=datetime.now().strftime('%Y%m%d')
                rows=c.execute("SELECT booking_code FROM bookings WHERE booking_code LIKE ? ORDER BY id DESC",(f'UTSBID-{day}-%',)).fetchall()
                serial=0
                for rr in rows:
                    m=re.match(rf'^UTSBID-{day}-(\d+)$', str(rr['booking_code'] or ''))
                    if m: serial=max(serial,int(m.group(1)))
                code=f'UTSBID-{day}-{serial+1:03d}'
                cur=c.execute('''INSERT INTO bookings(booking_code,customer_id,service_id,offer_id,address,date,time,problem,amount,status,created_at)
                                 VALUES(?,?,?,?,?,?,?,?,?,?,?)''',(code,cid,sid,offer_id or None,str(d.get('address','')).strip(),str(d.get('date','')),str(d.get('time','')),str(d.get('problem','')).strip(),amount,'Pending',now()))
                if offer_id:c.execute('INSERT INTO offer_activity(offer_id,customer_id,activity,created_at) VALUES(?,?,?,?)',(offer_id,cid,'book',now()))
                c.commit(); notify_customer(c,cid,'Booking confirmed',f'Your booking {code} has been created.',cur.lastrowid); c.commit(); return send_json(self,201,{'id':cur.lastrowid,'booking_code':code,'status':'Pending','amount':amount})
            if p.startswith('/api/engineers/') and p.endswith('/login'):
                key=p.split('/')[3].strip().upper()
                phone=re.sub(r'\D','',str(d.get('phone','')))[-10:]
                e=c.execute('SELECT * FROM engineers WHERE engineer_code=? AND active=1',(key,)).fetchone()
                if not e:
                    try: e=c.execute('SELECT * FROM engineers WHERE id=? AND active=1',(int(key),)).fetchone()
                    except Exception: e=None
                if not e or phone!=re.sub(r'\D','',e['phone'])[-10:]: return send_json(self,401,{'error':'Engineer ID or phone is incorrect'})
                return send_json(self,200,{'engineer':dict(e)})
            if p.startswith('/api/engineers/') and '/jobs/' in p and p.endswith('/status'):
                parts=p.strip('/').split('/')
                key=parts[2]; value=parts[4]
                e=c.execute('SELECT id FROM engineers WHERE engineer_code=? AND active=1',(key,)).fetchone()
                if not e:
                    try: e=c.execute('SELECT id FROM engineers WHERE id=? AND active=1',(int(key),)).fetchone()
                    except Exception: e=None
                eid=e['id'] if e else 0
                if not eid: return send_json(self,404,{'error':'Engineer not found'})
                st=str(d.get('status','')).strip(); allowed={'Assigned','On the Way','Arrived','Service Started','Completed'}
                if st not in allowed:return send_json(self,400,{'error':'Invalid engineer job status'})
                e=c.execute('SELECT id FROM engineers WHERE id=? AND active=1',(eid,)).fetchone(); b=c.execute('SELECT * FROM bookings WHERE (booking_code=? OR CAST(id AS TEXT)=?) AND engineer_id=?',(value,value,eid)).fetchone()
                if not e:return send_json(self,404,{'error':'Engineer not found'})
                if not b:return send_json(self,403,{'error':'This job is not assigned to you'})
                c.execute('UPDATE bookings SET status=?,engineer_updated_at=? WHERE id=?',(st,now(),b['id']))
                c.execute("UPDATE engineers SET status=? WHERE id=?",('Available' if st=='Completed' else 'On Job',eid))
                notify_customer(c,b['customer_id'],'Service update',f'Engineer updated booking status to {st}.',b['id'])
                c.commit(); return send_json(self,200,dict(booking_full(c,b['id'])))
            if p.startswith('/api/engineers/') and '/jobs/' in p and p.endswith('/notes'):
                parts=p.strip('/').split('/')
                key=parts[2]; value=parts[4]
                e=c.execute('SELECT id FROM engineers WHERE engineer_code=? AND active=1',(key,)).fetchone()
                if not e:
                    try: e=c.execute('SELECT id FROM engineers WHERE id=? AND active=1',(int(key),)).fetchone()
                    except Exception: e=None
                eid=e['id'] if e else 0
                b=c.execute('SELECT * FROM bookings WHERE (booking_code=? OR CAST(id AS TEXT)=?) AND engineer_id=?',(value,value,eid)).fetchone()
                if not b:return send_json(self,403,{'error':'This job is not assigned to you'})
                note=str(d.get('notes','')).strip()
                if len(note)>2000:return send_json(self,400,{'error':'Notes are too long'})
                c.execute('UPDATE bookings SET engineer_notes=?,engineer_updated_at=? WHERE id=?',(note,now(),b['id'])); c.commit(); return send_json(self,200,dict(booking_full(c,b['id'])))

            if p.startswith('/api/offers/') and p.endswith('/activity'):
                cid=require_customer(self)
                if not cid: return
                try: oid=int(p.strip('/').split('/')[2])
                except Exception: return send_json(self,400,{'error':'Invalid offer id'})
                if not c.execute("SELECT id FROM offers WHERE id=? AND status='active'",(oid,)).fetchone():
                    return send_json(self,404,{'error':'Offer not found'})
                activity=str(d.get('activity','view')).strip().lower()
                if activity not in {'view','explore','book'}:
                    return send_json(self,400,{'error':'Invalid offer activity'})
                c.execute('INSERT INTO offer_activity(offer_id,customer_id,activity,created_at) VALUES(?,?,?,?)',(oid,cid,activity,now())); c.commit()
                return send_json(self,201,{'ok':True,'activity':activity})
            if p=='/api/admin/offers':
                title=str(d.get('title','')).strip(); desc=str(d.get('description','')).strip(); discount=str(d.get('discount','')).strip(); fixed=int(d.get('fixed_price',0) or 0); price_text=str(d.get('price_text') or f'₹{fixed:,}').strip(); badge=str(d.get('badge','LIMITED OFFER')).strip() or 'LIMITED OFFER'; icon=str(d.get('icon','✦')).strip() or '✦'; valid=str(d.get('valid_until','')).strip(); status=str(d.get('status','active')).strip() or 'active'; sid=d.get('service_id') or None
                if not title or not desc or fixed<=0 or not sid: return send_json(self,400,{'error':'Offer title, description, service and fixed price are required'})
                cur=c.execute('INSERT INTO offers(title,description,discount,price_text,fixed_price,badge,icon,service_id,valid_until,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(title,desc,discount,price_text,fixed,badge,icon,sid,valid,status,now(),now())); c.commit()
                return send_json(self,201,dict(c.execute('SELECT * FROM offers WHERE id=?',(cur.lastrowid,)).fetchone()))
            if p=='/api/admin/services':
                name=str(d.get('name','')).strip(); price=int(d.get('price',0) or 0); icon=str(d.get('icon','◉')) or '◉'; desc=str(d.get('description','')); status=str(d.get('status','active'))
                if not name or price<0: return send_json(self,400,{'error':'Valid service required'})
                try: cur=c.execute('INSERT INTO services(name,icon,description,price,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(name,icon,desc,price,status,now(),now())); c.commit()
                except sqlite3.IntegrityError: return send_json(self,409,{'error':'Service name already exists'})
                return send_json(self,201,dict(c.execute('SELECT * FROM services WHERE id=?',(cur.lastrowid,)).fetchone()))
            if p=='/api/admin/engineers':
                name=str(d.get('name','')).strip(); phone=re.sub(r'\D','',str(d.get('phone','')))[-10:]; email=str(d.get('email','')).strip(); area=str(d.get('area','')).strip(); skills=str(d.get('skills','')).strip()
                exp=int(d.get('experience_years',0) or 0); rating=float(d.get('rating',5) or 5); joining=str(d.get('joining_date','')); status=str(d.get('status','Available'))
                if not name or len(phone)!=10 or not area: return send_json(self,400,{'error':'Name, 10-digit phone and area required'})
                cur=c.execute('INSERT INTO engineers(name,phone,email,area,skills,experience_years,rating,joining_date,status,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(name,phone,email,area,skills,exp,rating,joining,status,1,now()))
                new_id=cur.lastrowid
                code=f'UTSE-{new_id}'
                c.execute('UPDATE engineers SET engineer_code=? WHERE id=?',(code,new_id)); c.commit()
                return send_json(self,201,dict(c.execute('SELECT * FROM engineers WHERE id=?',(new_id,)).fetchone()))
            if p.startswith('/api/admin/bookings/') and p.endswith('/assign'):
                value=p.split('/')[4]; eid=int(d.get('engineer_id',0) or 0)
                b=c.execute('SELECT * FROM bookings WHERE booking_code=? OR CAST(id AS TEXT)=?',(value,value)).fetchone(); e=c.execute("SELECT * FROM engineers WHERE id=? AND active=1 AND status='Available'",(eid,)).fetchone()
                if not b:return send_json(self,404,{'error':'Booking not found'})
                if not e:return send_json(self,409,{'error':'Engineer not found or not available'})
                c.execute("UPDATE bookings SET engineer_id=?,status='Assigned' WHERE id=?",(eid,b['id'])); c.execute("UPDATE engineers SET status='On Job' WHERE id=?",(eid,)); notify_customer(c,b['customer_id'],'Engineer assigned',f'{e["name"]} has been assigned to your service.',b['id']); c.commit()
                return send_json(self,200,dict(booking_full(c,b['id'])))
            if p.startswith('/api/admin/bookings/') and p.endswith('/status'):
                value=p.split('/')[4]; st=str(d.get('status','')).strip()
                allowed={'Pending','Assigned','On the Way','Arrived','Service Started','Completed','Closed','Cancelled'}
                if st not in allowed:return send_json(self,400,{'error':'Invalid booking status'})
                b=c.execute('SELECT * FROM bookings WHERE booking_code=? OR CAST(id AS TEXT)=?',(value,value)).fetchone()
                if not b:return send_json(self,404,{'error':'Booking not found'})
                if st=='Cancelled':
                    return send_json(self,403,{'error':'Bookings can only be cancelled by the customer before an engineer is assigned.'})
                if st=='On the Way':
                    from datetime import timedelta
                    eta=(datetime.now()+timedelta(hours=2)).isoformat(timespec='minutes')
                    c.execute('UPDATE bookings SET status=?,eta_until=? WHERE id=?',(st,eta,b['id'])); title='Engineer on the way'; msg='Your engineer is on the way. ETA is within 2 hours.'
                elif st=='Arrived': c.execute('UPDATE bookings SET status=?,arrived_at=? WHERE id=?',(st,now(),b['id'])); title='Engineer arrived'; msg='Your engineer has arrived at the service location.'
                elif st=='Service Started': c.execute('UPDATE bookings SET status=?,started_at=? WHERE id=?',(st,now(),b['id'])); title='Service started'; msg='Your service has started.'
                elif st=='Completed': c.execute('UPDATE bookings SET status=?,completed_at=? WHERE id=?',(st,now(),b['id'])); title='Service completed'; msg='Admin marked the service completed. Please confirm from your app.'
                elif st=='Closed':
                    c.execute('UPDATE bookings SET status=?,closed_at=? WHERE id=?',(st,now(),b['id'])); title='Booking closed'; msg='Your service booking is now closed.'
                    if b['engineer_id']: c.execute("UPDATE engineers SET status='Available' WHERE id=?",(b['engineer_id'],))
                else: c.execute('UPDATE bookings SET status=? WHERE id=?',(st,b['id'])); title='Booking updated'; msg=f'Your booking status is now {st}.'
                notify_customer(c,b['customer_id'],title,msg,b['id'])
                c.commit();return send_json(self,200,dict(booking_full(c,b['id'])))

            if p.startswith('/api/bookings/') and p.endswith('/cancel'):
                value=p.split('/')[3]
                customer_id=require_customer(self)
                if not customer_id:
                    return send_json(self,401,{'error':'Customer login required. Please login again.'})
                b=c.execute('SELECT * FROM bookings WHERE (booking_code=? OR CAST(id AS TEXT)=?) AND customer_id=?',(value,value,customer_id)).fetchone()
                if not b:return send_json(self,404,{'error':'Booking not found'})
                if b['engineer_id'] or b['status'] != 'Pending':
                    return send_json(self,409,{'error':'This booking can only be cancelled before an engineer is assigned.'})
                reason=str(d.get('reason','')).strip()[:500]
                if not reason:
                    return send_json(self,400,{'error':'Please select or enter a cancellation reason.'})
                c.execute("UPDATE bookings SET status='Cancelled', cancellation_reason=? WHERE id=?",(reason,b['id']))
                notify_customer(c,b['customer_id'],'Booking cancelled',f'Your booking {b["booking_code"]} has been cancelled successfully. Reason: {reason}',b['id'])
                c.commit()
                return send_json(self,200,dict(booking_full(c,b['id'])))
            if p.startswith('/api/bookings/') and p.endswith('/confirm'):
                value=p.split('/')[3]; customer_id=require_customer(self)
                if not customer_id: return
                b=c.execute('SELECT * FROM bookings WHERE booking_code=? OR CAST(id AS TEXT)=?',(value,value)).fetchone()
                if not b:return send_json(self,404,{'error':'Booking not found'})
                if b['customer_id']!=customer_id:return send_json(self,403,{'error':'Customer mismatch'})
                if b['status']!='Completed':return send_json(self,409,{'error':'Admin must mark the service Completed first'})
                c.execute("UPDATE bookings SET customer_confirmed_at=?,status='Closed',closed_at=? WHERE id=?",(now(),now(),b['id']))
                if b['engineer_id']: c.execute("UPDATE engineers SET status='Available' WHERE id=?",(b['engineer_id'],))
                notify_customer(c,b['customer_id'],'Service closed','Thank you. Your service booking is now closed.',b['id'])
                c.commit();return send_json(self,200,dict(booking_full(c,b['id'])))

            if p.startswith('/api/bookings/') and p.endswith('/pay'):
                value=p.split('/')[3]; cid=require_customer(self)
                if not cid: return
                b=c.execute('SELECT * FROM bookings WHERE booking_code=? OR CAST(id AS TEXT)=?',(value,value)).fetchone()
                if not b:return send_json(self,404,{'error':'Booking not found'})
                if b['customer_id']!=cid:return send_json(self,403,{'error':'Customer mismatch'})
                if b['status'] not in ('Completed','Closed'):return send_json(self,409,{'error':'Payment available after completion'})
                utr=str(d.get('utr','')).strip()
                if len(utr)<4:return send_json(self,400,{'error':'Please enter a valid UTR / transaction ID'})
                pid='PAY-'+secrets.token_hex(4).upper()
                paid_at=now()
                c.execute("UPDATE bookings SET payment_status='Paid',payment_id=?,payment_utr=?,paid_at=? WHERE id=?",(pid,utr,paid_at,b['id']))
                notify_customer(c,cid,'Payment successful',f'Payment received. UTR {utr}. Receipt {pid}.',b['id'])
                c.commit();return send_json(self,200,dict(booking_full(c,b['id'])))

            if p.startswith('/api/customer/') and p.endswith('/support'):
                session_cid=require_customer(self)
                if not session_cid: return

                try: cid=int(p.split('/')[3])
                except Exception: return send_json(self,400,{'error':'Invalid customer id'})
                if cid != session_cid: return send_json(self,403,{'error':'Customer access denied'})
                subject=str(d.get('subject','')).strip(); message=str(d.get('message','')).strip(); booking_id=d.get('booking_id')
                if not subject or not message:return send_json(self,400,{'error':'Subject and message are required'})
                if len(subject)>120 or len(message)>2000:return send_json(self,400,{'error':'Message is too long'})
                if booking_id:
                    try: booking_id=int(booking_id)
                    except: booking_id=None
                    if booking_id and not c.execute('SELECT id FROM bookings WHERE id=? AND customer_id=?',(booking_id,cid)).fetchone(): return send_json(self,403,{'error':'Booking mismatch'})
                cur=c.execute('INSERT INTO support_tickets(customer_id,booking_id,subject,message,status,created_at) VALUES(?,?,?,?,?,?)',(cid,booking_id,subject,message,'Open',now()))
                notify_customer(c,cid,'Support request received',f'Your support ticket #{cur.lastrowid} is open.',booking_id)
                c.commit(); return send_json(self,201,dict(c.execute('SELECT * FROM support_tickets WHERE id=?',(cur.lastrowid,)).fetchone()))
            if p.startswith('/api/bookings/') and p.endswith('/review'):
                value=p.split('/')[3]; cid=require_customer(self)
                if not cid: return
                rating=int(d.get('rating',0) or 0); review=str(d.get('review','')).strip()
                b=c.execute('SELECT * FROM bookings WHERE booking_code=? OR CAST(id AS TEXT)=?',(value,value)).fetchone()
                if not b:return send_json(self,404,{'error':'Booking not found'})
                if b['customer_id']!=cid:return send_json(self,403,{'error':'Customer mismatch'})
                if b['status'] not in ('Completed','Closed'):return send_json(self,409,{'error':'Review available after completion'})
                if rating<1 or rating>5:return send_json(self,400,{'error':'Rating must be 1 to 5'})
                c.execute('UPDATE bookings SET review_rating=?,review_text=?,reviewed_at=? WHERE id=?',(rating,review,now(),b['id']))
                notify_customer(c,cid,'Review submitted','Thank you for rating your service.',b['id']); c.commit();return send_json(self,200,dict(booking_full(c,b['id'])))
            self.send_error(404)
        finally:c.close()
    def do_PUT(self):
        p=urlparse(self.path).path; d=read_json(self); c=conn()
        try:
            if p.startswith('/api/customer/') and '/addresses/' in p:
                session_cid=require_customer(self)
                if not session_cid:return
                parts=p.split('/')
                try: cid=int(parts[3]); aid=int(parts[5])
                except Exception:return send_json(self,400,{'error':'Invalid address'})
                if cid!=session_cid:return send_json(self,403,{'error':'Customer access denied'})
                c.execute('''CREATE TABLE IF NOT EXISTS customer_addresses(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER NOT NULL,label TEXT NOT NULL DEFAULT 'Default Address',area TEXT DEFAULT '',pincode TEXT DEFAULT '',address TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,is_default INTEGER NOT NULL DEFAULT 0)''')
                r=c.execute('SELECT * FROM customer_addresses WHERE id=? AND customer_id=?',(aid,cid)).fetchone()
                if not r:return send_json(self,404,{'error':'Address not found'})
                address=str(d.get('address',r['address'])).strip(); area=str(d.get('area',r['area'] or '')).strip(); pincode=str(d.get('pincode',r['pincode'] or '')).strip(); label=str(d.get('label',r['label'] or 'Address')).strip() or 'Address'; is_default=1 if d.get('is_default') else 0
                if not address:return send_json(self,400,{'error':'Full address is required'})
                if pincode and (not pincode.isdigit() or len(pincode)!=6):return send_json(self,400,{'error':'Enter a valid 6-digit pincode'})
                if is_default:c.execute('UPDATE customer_addresses SET is_default=0 WHERE customer_id=?',(cid,))
                c.execute('UPDATE customer_addresses SET label=?,area=?,pincode=?,address=?,updated_at=?,is_default=? WHERE id=? AND customer_id=?',(label,area,pincode,address,now(),is_default,aid,cid)); c.commit(); return send_json(self,200,dict(c.execute('SELECT * FROM customer_addresses WHERE id=?',(aid,)).fetchone()))
            if p.startswith('/api/customer/') and p.endswith('/profile-change-otp'):
                session_cid=require_customer(self)
                if not session_cid: return
                try: cid=int(p.split('/')[3])
                except Exception: return send_json(self,400,{'error':'Invalid customer id'})
                if cid != session_cid: return send_json(self,403,{'error':'Customer access denied'})
                r=c.execute('SELECT * FROM customers WHERE id=?',(cid,)).fetchone()
                if not r:return send_json(self,404,{'error':'Customer not found'})
                typ=str(d.get('type','')).strip().lower(); value=str(d.get('value','')).strip()
                if typ not in ('email','mobile'): return send_json(self,400,{'error':'Invalid change type'})
                if typ=='email':
                    if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$',value): return send_json(self,400,{'error':'Enter a valid email address.'})
                    other=c.execute('SELECT id FROM customers WHERE lower(email)=lower(?) AND id<>?',(value,cid)).fetchone()
                    if other:return send_json(self,409,{'error':'This email is already registered with another account.'})
                else:
                    value=re.sub(r'\D','',value)[-10:]
                    if len(value)!=10:return send_json(self,400,{'error':'Enter a valid 10-digit mobile number.'})
                    other=c.execute('SELECT id FROM customers WHERE phone=? AND id<>?',(value,cid)).fetchone()
                    if other:return send_json(self,409,{'error':'This mobile number is already registered with another account.'})
                otp=str(d.get('otp','')).strip()
                if otp!='123456': return send_json(self,401,{'error':'Invalid OTP'})
                if typ=='email': c.execute('UPDATE customers SET email=? WHERE id=?',(value.lower(),cid))
                else: c.execute('UPDATE customers SET phone=? WHERE id=?',(value,cid))
                notify_customer(c,cid,'Contact details updated',f'Your {typ} was changed successfully.'); c.commit()
                return send_json(self,200,{'customer':dict(c.execute('SELECT * FROM customers WHERE id=?',(cid,)).fetchone()),'message':'Profile contact updated successfully.'})
            if p.startswith('/api/customer/') and p.endswith('/profile'):
                session_cid=require_customer(self)
                if not session_cid: return

                try: cid=int(p.split('/')[3])
                except Exception: return send_json(self,400,{'error':'Invalid customer id'})
                if cid != session_cid: return send_json(self,403,{'error':'Customer access denied'})
                r=c.execute('SELECT * FROM customers WHERE id=?',(cid,)).fetchone()
                if not r:return send_json(self,404,{'error':'Customer not found'})
                name=str(d.get('name',r['name'])).strip() or r['name']; email=str(d.get('email',r['email'] or '')).strip(); area=str(d.get('area',r['area'] or '')).strip(); pincode=str(d.get('pincode',r['pincode'] or '')).strip(); address=str(d.get('address',r['address'] or '')).strip()
                if not area:return send_json(self,400,{'error':'Area is required'})
                if not re.match(r'^\d{6}$',pincode):return send_json(self,400,{'error':'Valid 6-digit pincode is required'})
                if len(address)<8:return send_json(self,400,{'error':'Complete service address is required'})
                c.execute('UPDATE customers SET name=?,email=?,area=?,address=?,pincode=? WHERE id=?',(name,email,area,address,pincode,cid)); notify_customer(c,cid,'Profile updated','Your personal details and service address were updated.'); c.commit()
                return send_json(self,200,dict(c.execute('SELECT * FROM customers WHERE id=?',(cid,)).fetchone()))
            if p.startswith('/api/admin/offers/'):
                oid=int(p.rsplit('/',1)[1]); r=c.execute('SELECT * FROM offers WHERE id=?',(oid,)).fetchone()
                if not r:return send_json(self,404,{'error':'Offer not found'})
                fixed=int(d.get('fixed_price',r['fixed_price'] if 'fixed_price' in r.keys() else 0) or 0); sid=d.get('service_id',r['service_id']) or None
                price_text=str(d.get('price_text','')).strip() or f'₹{fixed:,}'
                vals=(str(d.get('title',r['title'])).strip(),str(d.get('description',r['description'])).strip(),str(d.get('discount',r['discount'])).strip(),price_text,fixed,str(d.get('badge',r['badge'])).strip() or 'LIMITED OFFER',str(d.get('icon',r['icon'])).strip() or '✦',sid,str(d.get('valid_until',r['valid_until'])).strip(),str(d.get('status',r['status'])).strip() or 'active')
                if not vals[0] or not vals[1] or vals[4]<=0 or not sid:return send_json(self,400,{'error':'Offer title, description, service and fixed price are required'})
                c.execute('UPDATE offers SET title=?,description=?,discount=?,price_text=?,fixed_price=?,badge=?,icon=?,service_id=?,valid_until=?,status=?,updated_at=? WHERE id=?',(*vals,now(),oid)); c.commit(); return send_json(self,200,dict(c.execute('SELECT * FROM offers WHERE id=?',(oid,)).fetchone()))
            if p.startswith('/api/admin/services/'):
                sid=int(p.rsplit('/',1)[1]); r=c.execute('SELECT * FROM services WHERE id=?',(sid,)).fetchone()
                if not r:return send_json(self,404,{'error':'Service not found'})
                c.execute('UPDATE services SET name=?,icon=?,description=?,price=?,status=?,updated_at=? WHERE id=?',(str(d.get('name',r['name'])),str(d.get('icon',r['icon'])),str(d.get('description',r['description'])),int(d.get('price',r['price'])),str(d.get('status',r['status'])),now(),sid)); c.commit(); return send_json(self,200,dict(c.execute('SELECT * FROM services WHERE id=?',(sid,)).fetchone()))
            if p.startswith('/api/admin/engineers/'):
                eid=int(p.rsplit('/',1)[1]); r=c.execute('SELECT * FROM engineers WHERE id=?',(eid,)).fetchone()
                if not r:return send_json(self,404,{'error':'Engineer not found'})
                vals=(str(d.get('name',r['name'])),re.sub(r'\D','',str(d.get('phone',r['phone'])))[-10:],str(d.get('email',r['email'] or '')),str(d.get('area',r['area'] or '')),str(d.get('skills',r['skills'] or '')),int(d.get('experience_years',r['experience_years'] or 0) or 0),float(d.get('rating',r['rating'] if r['rating'] is not None else 5)),str(d.get('joining_date',r['joining_date'] or '')),str(d.get('status',r['status'] or 'Available')),int(d.get('active',r['active'])))
                if not vals[0] or len(vals[1])!=10 or not vals[3] or not 0<=vals[6]<=5:return send_json(self,400,{'error':'Invalid engineer details'})
                c.execute('''UPDATE engineers SET name=?,phone=?,email=?,area=?,skills=?,experience_years=?,rating=?,joining_date=?,status=?,active=? WHERE id=?''',(*vals,eid)); c.commit(); return send_json(self,200,dict(c.execute('SELECT * FROM engineers WHERE id=?',(eid,)).fetchone()))
            self.send_error(404)
        finally:c.close()
    def do_DELETE(self):
        p=urlparse(self.path).path; c=conn()
        try:
            if p.startswith('/api/admin/offers/'):
                oid=int(p.rsplit('/',1)[1]); r=c.execute('SELECT id FROM offers WHERE id=?',(oid,)).fetchone()
                if not r:return send_json(self,404,{'error':'Offer not found'})
                c.execute('DELETE FROM offers WHERE id=?',(oid,)); c.commit(); return send_json(self,200,{'ok':True})
            if p.startswith('/api/admin/services/'):
                sid=int(p.rsplit('/',1)[1]); used=c.execute('SELECT COUNT(*) n FROM bookings WHERE service_id=?',(sid,)).fetchone()['n']
                if used:c.execute("UPDATE services SET status='hidden',updated_at=? WHERE id=?",(now(),sid))
                else:c.execute('DELETE FROM services WHERE id=?',(sid,))
                c.commit();return send_json(self,200,{'ok':True})
            if p.startswith('/api/admin/engineers/'):
                eid=int(p.rsplit('/',1)[1]); active=c.execute("SELECT COUNT(*) n FROM bookings WHERE engineer_id=? AND status IN ('Assigned','On the Way')",(eid,)).fetchone()['n']
                if active:return send_json(self,409,{'error':'Engineer has active jobs; set Offline instead'})
                c.execute("UPDATE engineers SET active=0,status='Offline' WHERE id=?",(eid,)); c.commit(); return send_json(self,200,{'ok':True})
            self.send_error(404)
        finally:c.close()

migrate_db()

if __name__=='__main__':
    print(f'Unique Techno running on port {PORT}')
    ThreadingHTTPServer(('0.0.0.0',PORT),Handler).serve_forever()
