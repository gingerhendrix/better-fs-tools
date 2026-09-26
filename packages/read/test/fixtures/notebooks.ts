/**
 * Notebook fixtures for the notebook converter. The corpus notebook
 * (`analysis.ipynb`) has no cells; this one has markdown, code, and each
 * output type the converter renders.
 */
export const notebook = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: "python3" } },
  cells: [
    { cell_type: "markdown", metadata: {}, source: ["# Title\n", "\n", "Some text."] },
    {
      cell_type: "code",
      metadata: {},
      execution_count: 1,
      source: "print('hi')\n",
      outputs: [{ output_type: "stream", name: "stdout", text: ["hi\n"] }],
    },
    {
      cell_type: "code",
      metadata: {},
      execution_count: 2,
      source: ["1 + 1"],
      outputs: [
        { output_type: "execute_result", execution_count: 2, data: { "text/plain": ["2"] } },
        { output_type: "display_data", data: { "image/png": "iVBORw0K" } },
        { output_type: "error", ename: "ValueError", evalue: "bad", traceback: [] },
      ],
    },
    { cell_type: "raw", metadata: {}, source: "" },
  ],
};

export const notebookText = JSON.stringify(notebook, null, 1);
