const sq = require('square');
const tmp = new sq.SquareClient({ token: 'fake', environment: 'sandbox' });
const apis = ['catalog', 'cards', 'customers', 'disputes', 'inventory', 'invoices', 'oAuth', 'payments', 'payouts', 'refunds', 'bankAccounts', 'orders', 'webhooks', 'applePay'];
for (const api of apis) {
    const obj = tmp[api];
    if (!obj) { console.log(api + ': NOT FOUND'); continue; }
    const proto = Object.getPrototypeOf(obj);
    const methods = Object.getOwnPropertyNames(proto).filter(function (m) { return m !== 'constructor' && m[0] !== '_'; });
    console.log(api + ': ' + methods.join(', '));
}
