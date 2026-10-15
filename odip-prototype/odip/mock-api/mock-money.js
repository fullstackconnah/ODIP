// Money comparisons the mock shares, in whole cents, because a double puts 1,024.12 x 100 at 102411.99999999999 where the server's decimal says 102412.

const cents = (n) => Math.round(n * 100)

/** The whole percent of `available` that `used` is, or null while it is under `percent`: the server's "approaching" rule (used x 100 >= percent x available), and its floored percentage. */
const approachingAt = (used, available, percent) => {
  const [u, a] = [cents(used), cents(available)]
  return a > 0 && u * 100 >= percent * a ? Math.floor((u * 100) / a) : null
}

module.exports = { cents, approachingAt }
