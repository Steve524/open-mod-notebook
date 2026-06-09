import asyncio
from typing import Annotated, Optional

import aiosqlite
from ai_prompter import Prompter
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

from open_notebook.ai.provision import provision_langchain_model
from open_notebook.config import LANGGRAPH_CHECKPOINT_FILE
from open_notebook.domain.notebook import Notebook
from open_notebook.exceptions import OpenNotebookError
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.error_classifier import classify_error
from open_notebook.utils.text_utils import extract_text_content


class ThreadState(TypedDict):
    messages: Annotated[list, add_messages]
    notebook: Optional[Notebook]
    context: Optional[str]
    context_config: Optional[dict]
    model_override: Optional[str]


async def call_model_with_messages(state: ThreadState, config: RunnableConfig) -> dict:
    try:
        system_prompt = Prompter(prompt_template="chat/system").render(data=state)  # type: ignore[arg-type]
        payload = [SystemMessage(content=system_prompt)] + state.get("messages", [])
        model_id = config.get("configurable", {}).get("model_id") or state.get(
            "model_override"
        )

        model = await provision_langchain_model(
            str(payload), model_id, "chat", max_tokens=8192
        )
        ai_message = await model.ainvoke(payload)

        # Clean thinking content from AI response (e.g., <think>...</think> tags)
        content = extract_text_content(ai_message.content)
        cleaned_content = clean_thinking_content(content)
        cleaned_message = ai_message.model_copy(update={"content": cleaned_content})

        return {"messages": cleaned_message}
    except OpenNotebookError:
        raise
    except Exception as e:
        error_class, user_message = classify_error(e)
        raise error_class(user_message) from e


# AsyncSqliteSaver must be constructed inside a running event loop (its __init__
# grabs the loop), so the graph is compiled lazily on first use and cached. Each
# aiosqlite connection runs SQLite on its own thread, which removes the shared
# sync-connection concurrency hazard that the old sync SqliteSaver had.
_graph = None
_graph_lock = asyncio.Lock()


def _build_chat_graph() -> StateGraph:
    builder = StateGraph(ThreadState)
    builder.add_node("agent", call_model_with_messages)
    builder.add_edge(START, "agent")
    builder.add_edge("agent", END)
    return builder


async def get_chat_graph():
    """Return the compiled chat graph (async checkpointer), building it once."""
    global _graph
    if _graph is None:
        async with _graph_lock:
            if _graph is None:
                conn = aiosqlite.connect(
                    LANGGRAPH_CHECKPOINT_FILE, check_same_thread=False
                )
                _graph = _build_chat_graph().compile(
                    checkpointer=AsyncSqliteSaver(conn)
                )
    return _graph
