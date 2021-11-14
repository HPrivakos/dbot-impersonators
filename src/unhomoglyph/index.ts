/*
  From https://github.com/nodeca/unhomoglyph under license MIT
*/

import data from "./data";

function escapeRegexp(str: string) {
  return str.replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
}

const REPLACE_RE = RegExp(Object.keys(data).map(escapeRegexp).join("|"), "g");

function replace_fn(match: string) {
  return data[match];
}

function unhomoglyph(str: string) {
  return str.replace(REPLACE_RE, replace_fn);
}

export default unhomoglyph