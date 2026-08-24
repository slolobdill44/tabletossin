// Test double for the tagged-template query function returned by neon().
//
// createFakeSql([{ match: /FROM sessions/, rows: [...] }, ...]) returns a
// function usable as sql`SELECT ...`. Each call is matched against the rules
// in order (first match wins) and recorded on sql.calls as { text, values }.
// A rule's `rows` may be an array or a function of the interpolated values;
// `error` makes the query reject.
function createFakeSql(rules) {
  const sql = function (strings, ...values) {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    sql.calls.push({ text, values });

    const rule = (rules || []).find((r) => r.match.test(text));
    if (!rule) {
      return Promise.reject(new Error('fake sql: no rule matched query: ' + text));
    }
    if (rule.error) return Promise.reject(rule.error);
    const rows = typeof rule.rows === 'function' ? rule.rows(values) : rule.rows;
    return Promise.resolve(rows);
  };
  sql.calls = [];
  return sql;
}

module.exports = { createFakeSql };
