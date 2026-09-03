use serde::{Deserialize, Serialize};

// E.g., "myVariable"
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Ident(pub String);

// E.g., "Just"
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProperName(pub String);

// E.g., ["Data", "Maybe"]
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ModuleName(pub Vec<String>);

// E.g., { "moduleName": ["Data", "Maybe"], "identifier": "Just" }
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Qualified<A> {
    pub module_name: Option<ModuleName>,
    pub identifier: A,
}

impl<A> Qualified<A> {
    pub fn new(module_name: Option<ModuleName>, identifier: A) -> Self {
        Self {
            module_name,
            identifier,
        }
    }
}
