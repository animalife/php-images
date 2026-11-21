// compare API（既定ブランチ...commit）の status。commit が既定ブランチの祖先なら behind、同じなら identical。
export function reachableFromDefault(status) {
  return status === 'behind' || status === 'identical';
}
