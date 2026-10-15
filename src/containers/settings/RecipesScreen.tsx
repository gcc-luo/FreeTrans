import { pathExistsSync, readJsonSync } from 'fs-extra';
import { type IReactionDisposer, autorun } from 'mobx';
import { inject, observer } from 'mobx-react';
import { Component, type ReactElement } from 'react';

import type { Params } from 'react-router-dom';
import type { StoresProps } from '../../@types/ferdium-components.types';
import RecipesDashboard from '../../components/settings/recipes/RecipesDashboard';
import ErrorBoundary from '../../components/util/ErrorBoundary';
import withParams from '../../components/util/WithParams';
import { resolveTranslationPlatformForRecipeId } from '../../features/messageTranslator/constants';
import { asarRecipesPath } from '../../helpers/asar-helpers';
import RecipePreview from '../../models/RecipePreview';

interface IProps extends Partial<StoresProps> {
  params: Params;
}

interface IState {
  needle: string | null;
  currentFilter: string;
}

@inject('stores', 'actions')
@observer
class RecipesScreen extends Component<IProps, IState> {
  autorunDisposer: IReactionDisposer | null = null;

  customRecipes: RecipePreview[] = [];

  constructor(props: IProps) {
    super(props);

    const allJsonPath = asarRecipesPath('all.json');
    this.customRecipes = pathExistsSync(allJsonPath)
      ? readJsonSync(allJsonPath)
      : [];
    this.state = {
      needle: null,
      currentFilter: 'featured',
    };
  }

  componentDidMount(): void {
    this.autorunDisposer = autorun(() => {
      const { filter } = this.props.params;
      const { currentFilter } = this.state;

      if (filter === 'all' && currentFilter !== 'all') {
        this.setState({ currentFilter: 'all' });
      } else if (currentFilter !== 'featured') {
        this.setState({ currentFilter: 'featured' });
      }
    });
  }

  componentWillUnmount(): void {
    this.props.stores!.services.resetStatus();

    if (typeof this.autorunDisposer === 'function') {
      this.autorunDisposer();
    }
  }

  searchRecipes(needle: string | null): void {
    if (needle === '') {
      this.resetSearch();
    } else {
      const { search } = this.props.actions!.recipePreview;
      this.setState({ needle });
      search({ needle });
    }
  }

  _sortByName(recipe1, recipe2): number {
    if (recipe1.name.toLowerCase() < recipe2.name.toLowerCase()) {
      return -1;
    }
    if (recipe1.name.toLowerCase() > recipe2.name.toLowerCase()) {
      return 1;
    }
    return 0;
  }

  prepareRecipes(recipes: RecipePreview[]): RecipePreview[] {
    return (
      recipes
        // Filter out duplicate recipes
        .filter((recipe, index, self) => {
          const ids = self.map(rec => rec.id);
          return ids.indexOf(recipe.id) === index;

          // Sort alphabetically
        })
        .sort(this._sortByName)
    );
  }

  prepareTranslationRecipes(recipes: RecipePreview[]): RecipePreview[] {
    return this.prepareRecipes(
      recipes.filter(recipe =>
        resolveTranslationPlatformForRecipeId(recipe.id),
      ),
    );
  }

  // Create an array of RecipePreviews from an array of recipe objects
  createPreviews(recipes: RecipePreview[]) {
    return recipes.map(recipe => new RecipePreview(recipe));
  }

  resetSearch(): void {
    this.setState({ needle: null, currentFilter: 'featured' });
  }

  render(): ReactElement {
    const { recipePreviews, recipes, services } = this.props.stores!;
    const { service: serviceActions } = this.props.actions!;
    const filter = this.state.currentFilter;

    let recipeFilter =
      filter === 'all'
        ? this.prepareTranslationRecipes([
            ...recipePreviews.all,
            ...this.createPreviews(this.customRecipes),
          ])
        : this.prepareTranslationRecipes([
            ...recipePreviews.featured,
            ...this.createPreviews(
              this.customRecipes.filter(recipe => recipe.featured),
            ),
          ]);
    recipeFilter = [...recipeFilter].sort(this._sortByName);

    const { needle } = this.state;
    const allRecipes =
      needle === null
        ? recipeFilter
        : this.prepareTranslationRecipes([
            // All search recipes from server
            ...recipePreviews.searchResults,
            // All search recipes from local recipes
            ...this.createPreviews(
              this.customRecipes.filter(
                (recipe: RecipePreview) =>
                  recipe.name.toLowerCase().includes(needle.toLowerCase()) ||
                  (recipe.aliases || []).some(alias =>
                    alias.toLowerCase().includes(needle.toLowerCase()),
                  ),
              ),
            ),
          ]).sort(this._sortByName);

    const isLoading =
      recipePreviews.featuredRecipePreviewsRequest.isExecuting ||
      recipePreviews.allRecipePreviewsRequest.isExecuting ||
      recipes.installRecipeRequest.isExecuting ||
      recipePreviews.searchRecipePreviewsRequest.isExecuting;

    return (
      <ErrorBoundary>
        <RecipesDashboard
          recipes={allRecipes}
          isLoading={isLoading}
          hasLoadedRecipes={
            recipePreviews.featuredRecipePreviewsRequest.wasExecuted
          }
          showAddServiceInterface={serviceActions.showAddServiceInterface}
          searchRecipes={e => this.searchRecipes(e)}
          resetSearch={() => this.resetSearch()}
          serviceStatus={services.actionStatus}
          recipeFilter={filter}
        />
      </ErrorBoundary>
    );
  }
}

export default withParams(RecipesScreen);
