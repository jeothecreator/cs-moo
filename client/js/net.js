// WebSocket transport with clock synchronisation.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.offset = 0;
    this.rtt = 0;
    this.bestRtt = Infinity;
    this.pingTimer = null;
    this.bytesIn = 0;
  }

  on(type, fn) {
    this.handlers.set(type, fn);
  }

  serverNow() {
    return performance.now() + this.offset;
  }

  connect({ room, name, team, mode, action }) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      let welcomed = false;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name, team, mode, action }));
      ws.onerror = () => { if (!welcomed) reject(new Error('Could not reach the server')); };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (!welcomed) reject(new Error('Connection closed'));
        else this.handlers.get('disconnect')?.({});
      };
      ws.onmessage = (ev) => {
        this.bytesIn += ev.data.length;
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'welcome') {
          welcomed = true;
          this.offset = msg.st - performance.now();
          this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: performance.now(), rtt: Math.round(this.rtt) }), 1000);
          resolve(msg);
        } else if (msg.t === 'error' && !welcomed) {
          reject(new Error(msg.msg));
          return;
        } else if (msg.t === 'pong') {
          const now = performance.now();
          const rtt = now - msg.ts;
          this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
          if (rtt <= this.bestRtt * 1.25) {
            this.bestRtt = Math.min(this.bestRtt, rtt);
            const off = msg.st + rtt / 2 - now;
            this.offset = this.offset * 0.7 + off * 0.3;
          }
        }
        this.handlers.get(msg.t)?.(msg);
      };
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close() {
    clearInterval(this.pingTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = null;
  }
}
