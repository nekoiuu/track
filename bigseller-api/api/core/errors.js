/**
 * error ชนิดเดียวของทั้งไลบรารี — ดู `kind` แล้วรู้เลยว่าต้องแก้ยังไง
 * ไม่ต้องไปไล่ stack trace
 */

/** @typedef {'no-cookie'|'auth'|'rate-limit'|'api'|'network'} ErrorKind */

export const KINDS = /** @type {const} */ ({
  NO_COOKIE:  'no-cookie',   // ยังไม่ได้ตั้ง / ตั้งผิดรูปแบบ → แก้ .env
  AUTH:       'auth',        // cookie ใช้ไม่ได้แล้ว → ดึงใหม่
  PERMISSION: 'permission',  // cookie ดี แต่บัญชีไม่มีสิทธิ์เมนูนั้น → ให้ admin เปิดให้
  RATE_LIMIT: 'rate-limit',  // ยิงถี่ไป → รอแล้วลองใหม่ (http.js retry ให้เอง)
  API:        'api',         // API ตอบ code != 0 ด้วยเหตุผลอื่น
  NETWORK:    'network',     // ต่อไม่ติดเลย
});

export class BigSellerError extends Error {
  /**
   * @param {string} message
   * @param {ErrorKind} kind
   * @param {{path?:string, status?:number, code?:number, msg?:string}} [detail]
   */
  constructor(message, kind, detail = {}) {
    super(message);
    this.name   = 'BigSellerError';
    this.kind   = kind;
    this.detail = detail;   // ข้อมูลดิบไว้ debug — endpoint ไหน, HTTP อะไร, code อะไร
  }

  /** true ถ้าลองใหม่แล้วมีโอกาสผ่าน (auth/no-cookie ลองไปก็เท่านั้น) */
  get retryable() {
    return this.kind === KINDS.RATE_LIMIT || this.kind === KINDS.NETWORK;
  }
}
