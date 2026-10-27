# Method Specification: Operation-Conditioned Change Propagation (OCCP)

## 1. Research Context & Prior Literature Framing

OCCP is an experimental hypothesis testing whether historical, typed multi-hop relationship paths are more useful when conditioned on the source-code edit operation.
We explicitly acknowledge that generic change-type conditioning, history+structure combination, path mining, and candidate boosting are established concepts in literature:
1. **Lehnert (2015):** *Multiperspective Change Impact Analysis to Support Software Maintenance and Reengineering* (explicit propagation rules combining change operation, artifact type, and dependency type).
2. **Abdeen et al. (2015):** *Learning Dependency-Based Change Impact Predictors Using Independent Change Histories* (Bayesian predictors for atomic change types from Change Impact Graphs).
3. **Huang et al. (2022):** *Change-Patterns Mapping: A Boosting Way for Change Impact Analysis* (mapping historical change patterns to impact predictions to boost candidate confidence).
4. **Zhou et al. (2024):** *Revealing Code Change Propagation Channels by Evolution History Mining* (mining frequent typed multi-hop change propagation channels from evolution history).
5. **Zhou et al. (2024):** *IMPER: Enhancing Change Impact Prediction by Integrating Evolutionary Coupling with Software Change Relationships*.

Our specific experimental inquiry is strictly narrower:
*Does conditioning historical typed path evidence on the source edit operation improve prediction compared with an otherwise equivalent context-independent path baseline on identical evaluation cases?*

---

## 2. Operation Taxonomy

1. `METHOD_SIGNATURE_OR_DECLARATION`: Modifications to method visibility, return types, parameter lists, or additions/deletions of method signatures.
2. `METHOD_BODY_OR_IMPLEMENTATION`: Modifications confined to statements within method implementations (control flow, assignments, invocations) without altering the method signature line.
3. `FIELD_OR_DATA_SHAPE`: Modifications to class fields, data model shapes, JPA/Jackson annotations.
4. `TYPE_OR_INHERITANCE`: Modifications to class, interface, enum declarations, `extends` or `implements` clauses, class-level annotations.
5. `ADD_DELETE_OR_RENAME`: File added, deleted, or renamed in Git revision history.
6. `UNKNOWN_OR_MIXED`: Multi-faceted modifications spanning multiple categories, or ambiguous/unparseable diff hunks.

---

## 3. Typed Path Signatures

Deterministic string signatures capture direction and component endpoint types:
- **1-Hop:** `(SourceType)-[dir:REL_TYPE]->(DestType)`
- **2-Hop:** `(SourceType)-[dir1:REL1]->(MidType)-[dir2:REL2]->(DestType)`
- **3-Hop:** `(SourceType)-[dir1:REL1]->(Mid1Type)-[dir2:REL2]->(Mid2Type)-[dir3:REL3]->(DestType)`

Relationship types strictly preserve semantics: `DEPENDS_ON`, `USES`, `EXTENDS`, `IMPLEMENTS`, `TESTS`. `EXTENDS` and `IMPLEMENTS` are strictly distinguished.

---

## 4. Models and Candidate Ranking

### Model A: Context-Independent Typed Path Baseline
$$\text{confidence}(p) = \frac{\text{positive\_opportunities}(p)}{\text{eligible\_opportunities}(p)}$$

### Model B: OCCP (Operation-Conditioned Path Model)
$$\text{confidence}(o, p) = \frac{\text{positive\_opportunities}(o, p)}{\text{eligible\_opportunities}(o, p)}$$

### Backoff Hierarchy:
If $(o, p)$ has zero positive support:
1. Fall back to generic path $(p)$ confidence.
2. Fall back to historical pairwise co-change frequency.
3. Fall back to structural baseline topological rank.

### Reciprocal Rank Fusion (RRF):
$$RRF(d) = \frac{1}{k + r_1(d)} + \frac{1}{k + r_2(d)}$$
Using standard constant $k = 60$ (Cormack et al., 2009).
