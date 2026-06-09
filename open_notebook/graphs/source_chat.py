import asyncio
from typing import Annotated, Dict, List, Optional

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
from open_notebook.domain.notebook import Source, SourceInsight
from open_notebook.exceptions import OpenNotebookError
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.context_builder import ContextBuilder
from open_notebook.utils.error_classifier import classify_error
from open_notebook.utils.text_utils import extract_text_content


class SourceChatState(TypedDict):
    messages: Annotated[list, add_messages]
    source_id: str
    source: Optional[Source]
    insights: Optional[List[SourceInsight]]
    context: Optional[str]
    model_override: Optional[str]
    context_indicators: Optional[Dict[str, List[str]]]


async def call_model_with_source_context(
    state: SourceChatState, config: RunnableConfig
) -> dict:
    """
    Main function that builds source context and calls the model.

    This function:
    1. Uses ContextBuilder to build source-specific context
    2. Applies the source_chat Jinja2 prompt template
    3. Handles model provisioning with override support
    4. Tracks context indicators for referenced insights/content
    """
    try:
        return await _call_model_with_source_context_inner(state, config)
    except OpenNotebookError:
        raise
    except Exception as e:
        error_class, user_message = classify_error(e)
        raise error_class(user_message) from e


async def _call_model_with_source_context_inner(
    state: SourceChatState, config: RunnableConfig
) -> dict:
    source_id = state.get("source_id")
    if not source_id:
        raise ValueError("source_id is required in state")

    # Build source context (async).
    context_builder = ContextBuilder(
        source_id=source_id,
        include_insights=True,
        include_notes=False,  # Focus on source-specific content
        max_tokens=50000,  # Reasonable limit for source context
    )
    context_data = await context_builder.build()

    # Extract source and insights from context
    source = None
    insights = []
    context_indicators: dict[str, list[str | None]] = {
        "sources": [],
        "insights": [],
        "notes": [],
    }

    if context_data.get("sources"):
        source_info = context_data["sources"][0]  # First source
        source = Source(**source_info) if isinstance(source_info, dict) else source_info
        context_indicators["sources"].append(source.id)

    if context_data.get("insights"):
        for insight_data in context_data["insights"]:
            insight = (
                SourceInsight(**insight_data)
                if isinstance(insight_data, dict)
                else insight_data
            )
            insights.append(insight)
            context_indicators["insights"].append(insight.id)

    # Format context for the prompt
    formatted_context = _format_source_context(context_data)

    # Build prompt data for the template
    prompt_data = {
        "source": source.model_dump() if source else None,
        "insights": [insight.model_dump() for insight in insights] if insights else [],
        "context": formatted_context,
        "context_indicators": context_indicators,
    }

    # Apply the source_chat prompt template
    system_prompt = Prompter(prompt_template="source_chat/system").render(
        data=prompt_data
    )
    payload = [SystemMessage(content=system_prompt)] + state.get("messages", [])

    model = await provision_langchain_model(
        str(payload),
        config.get("configurable", {}).get("model_id") or state.get("model_override"),
        "chat",
        max_tokens=8192,
    )
    ai_message = await model.ainvoke(payload)

    # Clean thinking content from AI response (e.g., <think>...</think> tags)
    content = extract_text_content(ai_message.content)
    cleaned_content = clean_thinking_content(content)
    cleaned_message = ai_message.model_copy(update={"content": cleaned_content})

    # Update state with context information
    return {
        "messages": cleaned_message,
        "source": source,
        "insights": insights,
        "context": formatted_context,
        "context_indicators": context_indicators,
    }


def _format_source_context(context_data: Dict) -> str:
    """
    Format the context data into a readable string for the prompt.

    Args:
        context_data: Context data from ContextBuilder

    Returns:
        Formatted context string
    """
    context_parts = []

    # Add source information
    if context_data.get("sources"):
        context_parts.append("## SOURCE CONTENT")
        for source in context_data["sources"]:
            if isinstance(source, dict):
                context_parts.append(f"**Source ID:** {source.get('id', 'Unknown')}")
                context_parts.append(f"**Title:** {source.get('title', 'No title')}")
                if source.get("full_text"):
                    # Truncate full text if too long
                    full_text = source["full_text"]
                    if len(full_text) > 5000:
                        full_text = full_text[:5000] + "...\n[Content truncated]"
                    context_parts.append(f"**Content:**\n{full_text}")
                context_parts.append("")  # Empty line for separation

    # Add insights
    if context_data.get("insights"):
        context_parts.append("## SOURCE INSIGHTS")
        for insight in context_data["insights"]:
            if isinstance(insight, dict):
                context_parts.append(f"**Insight ID:** {insight.get('id', 'Unknown')}")
                context_parts.append(
                    f"**Type:** {insight.get('insight_type', 'Unknown')}"
                )
                context_parts.append(
                    f"**Content:** {insight.get('content', 'No content')}"
                )
                context_parts.append("")  # Empty line for separation

    # Add metadata
    if context_data.get("metadata"):
        metadata = context_data["metadata"]
        context_parts.append("## CONTEXT METADATA")
        context_parts.append(f"- Source count: {metadata.get('source_count', 0)}")
        context_parts.append(f"- Insight count: {metadata.get('insight_count', 0)}")
        context_parts.append(f"- Total tokens: {context_data.get('total_tokens', 0)}")
        context_parts.append("")

    return "\n".join(context_parts)


# Lazily compiled with an AsyncSqliteSaver (built inside a running loop). See
# chat.py.get_chat_graph for the rationale.
_graph = None
_graph_lock = asyncio.Lock()


def _build_source_chat_graph() -> StateGraph:
    builder = StateGraph(SourceChatState)
    builder.add_node("source_chat_agent", call_model_with_source_context)
    builder.add_edge(START, "source_chat_agent")
    builder.add_edge("source_chat_agent", END)
    return builder


async def get_source_chat_graph():
    """Return the compiled source-chat graph (async checkpointer), built once."""
    global _graph
    if _graph is None:
        async with _graph_lock:
            if _graph is None:
                conn = aiosqlite.connect(
                    LANGGRAPH_CHECKPOINT_FILE, check_same_thread=False
                )
                _graph = _build_source_chat_graph().compile(
                    checkpointer=AsyncSqliteSaver(conn)
                )
    return _graph
