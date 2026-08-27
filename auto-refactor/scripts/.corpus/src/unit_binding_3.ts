export const handler = () => {
  const self = () => { return 'inner'; };
  const obj = { onClick: () => { return self(); } };
  obj.onClick = () => 42;
  exports.foo = function () { return 7; };
  return obj.onClick();
};
