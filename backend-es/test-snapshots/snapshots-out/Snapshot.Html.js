const $Html = (tag, _1, _2) => ({tag, _1, _2});
const Elem = value0 => value1 => $Html("Elem", value0, value1);
const Text = value0 => $Html("Text", value0);
const test = user => $Html(
  "Elem",
  "section",
  [
    $Html("Elem", "h1", [$Html("Text", "Posts for " + user)]),
    $Html(
      "Elem",
      "article",
      [$Html("Elem", "h2", [$Html("Text", "The first post")]), $Html("Elem", "p", [$Html("Text", "This is the first post."), $Html("Text", "Not much else to say.")])]
    )
  ]
);
export {$Html, Elem, Text, test};
